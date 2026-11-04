const toggle = document.getElementById("toggle");

chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
  toggle.checked = enabled;
});

toggle.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: toggle.checked });
});
