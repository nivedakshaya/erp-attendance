(function () {
    const savedTheme = localStorage.getItem("theme") || "dark";

    if (savedTheme === "light") {
        document.body.classList.add("light");
    }

    const btn = document.createElement("button");
    btn.className = "theme-toggle";
    btn.innerText = savedTheme === "light" ? "🌙 Dark" : "☀️ Light";

    btn.onclick = function () {
        document.body.classList.toggle("light");

        const isLight = document.body.classList.contains("light");
        localStorage.setItem("theme", isLight ? "light" : "dark");

        btn.innerText = isLight ? "🌙 Dark" : "☀️ Light";
    };

    document.body.appendChild(btn);
})();

function showToast(msg, type = "success") {
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.innerText = msg;

    document.body.appendChild(t);

    setTimeout(() => t.remove(), 3000);
}

function showLoader(targetId, text = "") {
    const el = document.getElementById(targetId);
    if (!el) return;

    el.innerHTML = `
        <div class="loader"></div>
        ${text ? `<div>${text}</div>` : ""}
    `;
}

function emptyRow(colspan, message = "📭 No records found") {
    return `
        <tr>
            <td colspan="${colspan}" class="empty-state">${message}</td>
        </tr>
    `;
}

function percentageClass(value) {
    const n = Number(value || 0);
    if (n >= 75) return "good";
    if (n >= 50) return "warn";
    return "bad";
}