self.addEventListener('push', event => {
 let payload = {}
 try { payload = event.data ? event.data.json() : {} } catch { return }
 event.waitUntil(self.registration.showNotification(typeof payload.title === 'string' ? payload.title : 'Delta Ridge', {
  body: typeof payload.body === 'string' ? payload.body : '', icon: '/icon.svg',
  tag: typeof payload.id === 'string' ? payload.id : 'delta-ridge-alert', data: { url: payload.url || '/' },
 }))
})
self.addEventListener('notificationclick', event => {
 event.notification.close()
 event.waitUntil((async () => {
  let url = new URL('/',self.location.origin)
  try { const candidate=new URL(event.notification.data.url,self.location.origin); if(candidate.origin===self.location.origin) url=candidate } catch { /* fall back home */ }
  const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true})
  for(const tab of tabs) if(new URL(tab.url).origin===url.origin) { await tab.navigate(url.href);return tab.focus() }
  return self.clients.openWindow(url.href)
 })())
})
