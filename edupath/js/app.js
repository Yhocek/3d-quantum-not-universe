/* EduPath — üniversite listesi, filtreler ve danışman modalı */
(function () {
    'use strict';

    const uniGrid = document.getElementById('uni-grid');
    const uniEmpty = document.getElementById('uni-empty');
    const searchInput = document.getElementById('uni-search');
    const countryFilters = document.getElementById('country-filters');
    const modal = document.getElementById('consultant-modal');
    const modalSubtitle = document.getElementById('modal-subtitle');
    const consultantList = document.getElementById('consultant-list');

    let activeCountry = 'Tümü';

    /* ---------------- istatistikler ---------------- */
    const countries = [...new Set(UNIVERSITIES.map(u => u.country))];
    document.getElementById('stat-uni').textContent = UNIVERSITIES.length;
    document.getElementById('stat-country').textContent = countries.length;
    document.getElementById('stat-consultant').textContent = CONSULTANTS.length;

    /* ---------------- ülke filtreleri ---------------- */
    ['Tümü', ...countries].forEach(country => {
        const btn = document.createElement('button');
        btn.className = 'chip' + (country === activeCountry ? ' active' : '');
        btn.textContent = country;
        btn.addEventListener('click', () => {
            activeCountry = country;
            countryFilters.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === btn));
            renderUniversities();
        });
        countryFilters.appendChild(btn);
    });

    /* ---------------- üniversite kartları ---------------- */
    function renderUniversities() {
        const q = searchInput.value.trim().toLocaleLowerCase('tr');
        const filtered = UNIVERSITIES.filter(u => {
            if (activeCountry !== 'Tümü' && u.country !== activeCountry) return false;
            if (!q) return true;
            const haystack = [u.name, u.city, u.country, ...u.programs].join(' ').toLocaleLowerCase('tr');
            return haystack.includes(q);
        });

        uniGrid.innerHTML = '';
        uniEmpty.hidden = filtered.length > 0;

        filtered.forEach(u => {
            const card = document.createElement('article');
            card.className = 'uni-card';
            card.innerHTML = `
                <div class="uni-top">
                    <div>
                        <div class="uni-name">${u.flag} ${esc(u.name)}</div>
                        <div class="uni-loc">${esc(u.city)}, ${esc(u.country)} · ${esc(u.language)}</div>
                    </div>
                    <span class="uni-rank">${esc(u.ranking)}</span>
                </div>
                <div class="uni-programs">${u.programs.map(p => `<span>${esc(p)}</span>`).join('')}</div>
                <dl class="uni-fees">
                    <div class="fee-main" style="display:contents">
                        <dt>Yıllık Eğitim Ücreti</dt><dd>${esc(u.tuition)}</dd>
                    </div>
                    <dt>Başvuru Ücreti</dt><dd>${esc(u.applicationFee)}</dd>
                    <dt>Son Başvuru</dt><dd>${esc(u.deadline)}</dd>
                </dl>
                <p class="uni-note">${esc(u.note)}</p>
                <button class="btn btn-outline btn-sm">Danışmanlık Al</button>`;
            card.querySelector('button').addEventListener('click', () => openModal(u));
            uniGrid.appendChild(card);
        });
    }

    searchInput.addEventListener('input', renderUniversities);

    /* ---------------- danışman modalı ---------------- */
    function openModal(university) {
        // Üniversite kartından açıldıysa o ülkenin uzmanları öne alınır ve işaretlenir
        let list = CONSULTANTS;
        if (university) {
            modalSubtitle.textContent =
                `${university.name} (${university.country}) için önerilen danışmanlar önceliklendirildi.`;
            list = [...CONSULTANTS].sort((a, b) =>
                b.countries.includes(university.country) - a.countries.includes(university.country));
        } else {
            modalSubtitle.textContent = 'Size uygun danışmanı seçin, ücretsiz ön görüşme planlayın.';
        }

        consultantList.innerHTML = '';
        list.forEach(c => {
            const recommended = university && c.countries.includes(university.country);
            const initials = c.name.split(' ').map(w => w[0]).join('');
            const card = document.createElement('div');
            card.className = 'consultant-card' + (recommended ? ' recommended' : '');
            card.innerHTML = `
                <div class="consultant-top">
                    <div class="avatar">${esc(initials)}</div>
                    <div>
                        <div class="consultant-name">${esc(c.name)}</div>
                        <div class="consultant-title">${esc(c.title)}</div>
                    </div>
                    ${recommended ? '<span class="badge-recommended">Önerilen</span>' : ''}
                </div>
                <div class="consultant-meta"><b>Uzmanlık:</b> ${esc(c.expertise)}</div>
                <div class="consultant-tags">
                    ${c.countries.map(k => `<span>📍 ${esc(k)}</span>`).join('')}
                    ${c.languages.map(l => `<span>${esc(l)}</span>`).join('')}
                </div>
                <div class="consultant-stats">
                    <span>⭐ <b>${c.rating}</b></span>
                    <span><b>${c.experience}</b> yıl deneyim</span>
                    <span><b>${c.sessions}+</b> görüşme</span>
                </div>
                <div class="consultant-actions">
                    <a class="btn btn-primary btn-sm" href="mailto:${esc(c.email)}?subject=${encodeURIComponent('Danışmanlık Talebi — ' + (university ? university.name : 'Genel'))}">Görüşme Planla</a>
                    <a class="btn btn-outline btn-sm" href="tel:${esc(c.phone.replace(/\s/g, ''))}">Ara</a>
                </div>`;
            consultantList.appendChild(card);
        });

        modal.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        modal.hidden = true;
        document.body.style.overflow = '';
    }

    document.querySelectorAll('[data-open-consultants]').forEach(btn =>
        btn.addEventListener('click', () => openModal(null)));
    modal.querySelector('[data-close-modal]').addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

    function esc(s) {
        return String(s).replace(/[&<>"']/g, ch =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    renderUniversities();
})();
