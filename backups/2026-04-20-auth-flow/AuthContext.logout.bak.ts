// Backup snapshot before logout redirect update.
const logout = () => {
  clearSession();
  window.location.href = '/';
};
