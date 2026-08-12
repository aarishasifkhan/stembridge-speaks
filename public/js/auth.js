// Shared authentication helper — include this on any page that requires login.

function getToken() {
  return localStorage.getItem("stembridge_auth_token");
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("stembridge_auth_user")) || null;
  } catch {
    return null;
  }
}

function saveAuth(token, user) {
  localStorage.setItem("stembridge_auth_token", token);
  localStorage.setItem("stembridge_auth_user", JSON.stringify(user));
}

function logout() {
  localStorage.removeItem("stembridge_auth_token");
  localStorage.removeItem("stembridge_auth_user");
  window.location.href = "/login.html";
}

// Call this at the top of any protected page. Redirects to login if not authenticated,
// and refreshes the stored user info from the server so it's never stale.
async function requireAuth() {
  const token = getToken();
  if (!token) {
    window.location.href =
      "/login.html?redirect=" + encodeURIComponent(window.location.pathname);
    return null;
  }
  try {
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) throw new Error("Invalid session");
    const user = await res.json();
    localStorage.setItem("stembridge_auth_user", JSON.stringify(user));
    return user;
  } catch (err) {
    logout();
    return null;
  }
}

// Helper for building authenticated fetch calls elsewhere in your code.
function authHeaders() {
  return { Authorization: "Bearer " + getToken() };
}
