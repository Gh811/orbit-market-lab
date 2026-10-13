"""Read a site's own raster icon after its company identity has been verified."""
import ipaddress
import socket
import ssl
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener, HTTPSHandler
from pathlib import Path

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None

class Icons(HTMLParser):
    def __init__(self):
        super().__init__(); self.urls=[]
    def handle_starttag(self, tag, attributes):
        row=dict(attributes)
        if tag=='link' and any(word in str(row.get('rel','')).lower().split() for word in ('icon','apple-touch-icon','apple-touch-icon-precomposed')):
            if row.get('href'):self.urls.append(row['href'])

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
    def read(url,limit):
        public_url(url,host)
        request=Request(url,headers={'User-Agent':'MarketDeskLocal/3.0','Accept':'image/*,text/html'})
        with opener.open(request,timeout=5) as response:
            payload=response.read(limit+1)
        if len(payload)>limit:raise ValueError('company icon response too large')
        return payload
    parser=Icons()
    try:parser.feed(read(website,262144).decode('utf-8','replace'))
    except (OSError,ValueError):pass
    from market_store import MarketStore
    for url in list(dict.fromkeys(urljoin(website,path) for path in parser.urls))[:3]:
        try:
            payload=read(url,262144)
            if MarketStore.logo_mime(payload):return payload,url
        except (OSError,ValueError):pass
    return None
