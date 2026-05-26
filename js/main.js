// Mobile nav toggle
document.addEventListener('DOMContentLoaded', () => {
  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      hamburger.classList.toggle('active');
    });
    // Close on link click
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        hamburger.classList.remove('active');
      });
    });
  }

  // Cookie consent
  const banner = document.querySelector('.cookie-banner');
  const accepted = localStorage.getItem('lighterme_cookies');
  if (!accepted && banner) {
    banner.classList.add('show');
  }

  document.getElementById('cookie-accept')?.addEventListener('click', () => {
    localStorage.setItem('lighterme_cookies', 'accepted');
    banner.classList.remove('show');
  });

  document.getElementById('cookie-reject')?.addEventListener('click', () => {
    localStorage.setItem('lighterme_cookies', 'rejected');
    banner.classList.remove('show');
  });
});
