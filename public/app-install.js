// Install the public app shell independently of account and catalog requests.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/app-sw.js', {scope: '/app', updateViaCache: 'none'}).then(registration => registration.update()).catch(() => {});
}
