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