import sys,re,json,urllib.request,urllib.parse,http.cookiejar,subprocess
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'
cj=http.cookiejar.CookieJar(); op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def req(url,data=None):
    h={'User-Agent':UA}
    if data is not None: h['X-Requested-With']='XMLHttpRequest'
    return op.open(urllib.request.Request(url,data=urllib.parse.urlencode(data).encode() if data is not None else None,headers=h)).read().decode('utf8','replace')
g=sys.argv[1]; want=sys.argv[2]
s=req(g); c=re.search(r'name="csrf_token" value="([^"]+)"',s).group(1)
page=json.loads(req(g+'/download_url',{'csrf_token':c}))['url']; p=req(page)
ups=re.findall(r'upload_id="(\d+)"',p); names=re.findall(r'<strong class="name" title="([^"]+)"',p)
print(list(zip(ups,names)))
for u,n in zip(ups,names):
    if want in n:
        url=json.loads(req(f"{g}/file/{u}?source=game_download",{'csrf_token':c}))['url']
        subprocess.run(['curl','-sL','-o','dl_'+n,url],check=True); print('saved','dl_'+n)
