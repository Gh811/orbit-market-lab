"""Coarse IP regions, queried offline. No user IP is sent to a third party."""
from functools import lru_cache
import ipaddress
import os
from pathlib import Path
from tools.ip2region import util,searcher


def client_ip(peer,headers):
    try:address=ipaddress.ip_address(peer)
    except ValueError:return ''
    # Only our local reverse proxy may provide forwarding headers. Caddy appends
    # the actual connecting address at the right end; ignore user-supplied left values.
    if address.is_loopback:
        candidate=headers.get('X-Forwarded-For','').split(',')[-1].strip()
        if candidate:
            try:return str(ipaddress.ip_address(candidate))
            except ValueError:return ''
    return str(address)


@lru_cache(maxsize=2)
def _index(path,version):
    util.verify_from_file(path)
    return util.load_vector_index_from_file(path)


@lru_cache(maxsize=4096)
def _lookup(ip,directory):
    try:
        address=ipaddress.ip_address(ip)
        if address.version==6 and address.ipv4_mapped:address=address.ipv4_mapped
        if not address.is_global:return '内网'
        path=str(Path(directory)/('ip2region_v'+str(address.version)+'.xdb'))
        version=util.IPv4 if address.version==4 else util.IPv6
        reader=searcher.new_with_vector_index(version,path,_index(path,address.version))
        try:raw=reader.search(str(address))
        finally:reader.close()
        parts=raw.split('|')
        if len(parts)<2:return '未知'
        country,province=parts[:2]
        names={'CN':'中国','SG':'新加坡','US':'美国','HK':'中国香港','MO':'中国澳门','TW':'中国台湾','JP':'日本','KR':'韩国','GB':'英国','CA':'加拿大','DE':'德国','FR':'法国','AU':'澳大利亚'}
        country=names.get(parts[-1],country)
        values=list(dict.fromkeys(p for p in [country,province] if p and p!='0'))
        return ' · '.join(values)[:96] or '未知'
    except (ValueError,OSError,IndexError,TypeError):return '未知'


def lookup(ip,account_path):
    directory=os.environ.get('MARKET_IP_REGION_DIR',str(Path(account_path).parent/'ip-region'))
    return _lookup(ip,directory) if ip else '未知'
