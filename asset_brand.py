"""Read a site's own raster icon after its company identity has been verified."""
import ipaddress
import socket
import ssl
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener, HTTPSHandler
from urllib.error import HTTPError
from http.client import HTTPException
from pathlib import Path

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None

class Icons(HTMLParser):
    """Prefer branding linked to this site's home, never a partner's logo."""
    VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
    def __init__(self,website=''):
        super().__init__();self.urls=[];self.brand_urls=[];self.stack=[];self.host=urlsplit(website).hostname
    def handle_starttag(self,tag,attributes):
        row=dict(attributes)
        if tag=='link' and any(word in str(row.get('rel','')).lower().split() for word in ('icon','apple-touch-icon','apple-touch-icon-precomposed')):
            if row.get('href'):self.urls.append(row['href'])
        marker=(row.get('class','')+' '+row.get('id','')).lower()
        logo=any(part=='logo' or part.startswith('logo-') or part.endswith('-logo') for part in marker.split())
        href=urlsplit(row.get('href',''))
        home=tag=='a' and href.path in ('/','/index.html','/index.php') and href.hostname in (None,self.host)
        if tag=='img' and row.get('src'):
            ancestors=self.stack
            in_home=any(entry[2] for entry in ancestors)
            in_header=any(entry[0] in ('header','nav') for entry in ancestors)
            has_logo=logo or any(entry[1] for entry in ancestors) or 'logo' in urlsplit(row['src']).path.lower()
            if has_logo and (in_home or in_header):self.brand_urls.append(row['src'])
        if tag not in self.VOID:self.stack.append((tag,logo,home))
    def handle_endtag(self,tag):
        for index in range(len(self.stack)-1,-1,-1):
            if self.stack[index][0]==tag:self.stack=self.stack[:index];break


def public_url(url, host):
    parsed=urlsplit(url)
    if parsed.scheme!='https' or parsed.hostname!=host or parsed.username or parsed.password or parsed.port not in (None,443):
        raise ValueError('icon must belong to the verified company website')
    addresses=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise ValueError('company website must use a public address')

def company_icon(website):
    host=urlsplit(website).hostname
    if not host:return None
    ca=Path('/etc/ssl/cert.pem')
    context=ssl.create_default_context(cafile=str(ca) if ca.is_file() else None)
    opener=build_opener(NoRedirect(),HTTPSHandler(context=context))
    allowed_hosts={host,host[4:] if host.startswith('www.') else 'www.'+host}
    resolved_page=website
    def read(url,limit):
        nonlocal resolved_page
        for attempt in range(4):
            current_host=urlsplit(url).hostname
            canonical=host.removeprefix('www.')
            if current_host not in allowed_hosts and not (current_host or '').endswith('.'+canonical):raise ValueError('redirect left verified company domain')
            public_url(url,current_host)
            request=Request(url,headers={'User-Agent':'Mozilla/5.0 MarketDeskLocal/3.0','Accept':'image/*,text/html','Referer':website})
            try:
                with opener.open(request,timeout=3) as response:payload=response.read(limit+1)
                if len(payload)>limit:raise ValueError('company icon response too large')
                if limit==1048576:resolved_page=url
                return payload
            except HTTPError as error:
                location=error.headers.get('Location')
                if error.code not in (301,302,303,307,308) or not location:raise
                error.close();url=urljoin(url,location)
        raise ValueError('too many company website redirects')
    parser=Icons(website)
    try:parser.feed(read(website,1048576).decode('utf-8','replace'))
    except (OSError,ValueError,HTTPException):pass
    from market_store import MarketStore
    for url in list(dict.fromkeys([*(urljoin(resolved_page,path) for path in parser.brand_urls+parser.urls),urljoin(website,'/favicon.ico')]))[:4]:
        try:
            payload=read(url,524288)
            if MarketStore.logo_mime(payload):return payload,url
        except (OSError,ValueError,HTTPException):pass
    return None
