(async function refreshAurelAcademy() {
  var status = document.getElementById('status');
  try {
    if ('serviceWorker' in navigator) {
      var registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(function unregister(registration) {
        return registration.unregister();
      }));
    }
    if ('caches' in window) {
      var keys = await window.caches.keys();
      await Promise.all(keys.map(function removeCache(key) {
        return window.caches.delete(key);
      }));
    }
  } catch (error) {
    // Private browsing can deny storage APIs. A network navigation is still
    // useful and the status page must never strand the student.
  }

  if (status) status.textContent = 'Version actuelle prête. Redirection…';
  // Return through the root document. The app will route the authenticated
  // user to the right space; this also avoids a same-document Safari race
  // where the just-unregistered worker can still intercept one final deep URL.
  window.location.replace('/?_aurel_refresh=' + Date.now());
}());
