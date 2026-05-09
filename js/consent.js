// Cookie Consent & GA Loader
(function() {
    const CONSENT_KEY = 'cp_cookie_consent';

    function getConsent() {
        return localStorage.getItem(CONSENT_KEY);
    }

    function setConsent(value) {
        localStorage.setItem(CONSENT_KEY, value);
    }

    function loadGA() {
        if (document.getElementById('ga-script')) return;
        const s = document.createElement('script');
        s.id = 'ga-script';
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=G-4D64BX6X5R';
        document.head.appendChild(s);
        window.dataLayer = window.dataLayer || [];
        window.gtag = function() { dataLayer.push(arguments); };
        gtag('js', new Date());
        gtag('config', 'G-4D64BX6X5R');
    }

    function showBanner() {
        if (document.getElementById('cookie-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'cookie-banner';
        banner.innerHTML = `
            <div style="
                position:fixed; bottom:0; left:0; right:0; z-index:9999;
                background:#1e1e2e; border-top:1px solid #3a3a50;
                padding:1rem 1.5rem;
                display:flex; align-items:center; justify-content:center;
                gap:1rem; flex-wrap:wrap;
                font-size:0.9rem; color:#ccc;
            ">
                <span>
                    This site uses Google Analytics to see how many people use the tool. That's it. No ads, no profiling, no dodgy stuff.
                    <a href="privacy.html" style="color:#6d7ce5; text-decoration:underline;">Privacy policy</a>
                </span>
                <div style="display:flex; gap:0.5rem; flex-shrink:0;">
                    <button id="cookie-accept" style="
                        background:#6d7ce5; color:#fff; border:none;
                        padding:0.4rem 1.2rem; border-radius:0.4rem;
                        font-weight:600; cursor:pointer;
                    ">Fine by me</button>
                    <button id="cookie-decline" style="
                        background:transparent; color:#8888a0; border:1px solid #3a3a50;
                        padding:0.4rem 1.2rem; border-radius:0.4rem;
                        cursor:pointer;
                    ">No thanks</button>
                </div>
            </div>
        `;
        document.body.appendChild(banner);

        document.getElementById('cookie-accept').addEventListener('click', function() {
            setConsent('accepted');
            loadGA();
            banner.remove();
        });
        document.getElementById('cookie-decline').addEventListener('click', function() {
            setConsent('declined');
            banner.remove();
        });
    }

    const consent = getConsent();
    if (consent === 'accepted') {
        loadGA();
    } else if (!consent) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', showBanner);
        } else {
            showBanner();
        }
    }
})();
