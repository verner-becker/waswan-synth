// SPDX-License-Identifier: GPL-3.0-only
// This document is a display surface. The host supplies the live workspace.
const token=location.hash.slice(1);
if(window.opener&&/^[a-f0-9-]{36}$/.test(token)){
  window.opener.postMessage({type:'waswan-daw-tab-ready',token},location.origin);
  history.replaceState(null,'',location.pathname);
}
