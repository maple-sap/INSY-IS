// ==========================================
// S.U.A.V.E. - JS
// ==========================================

// If the server says the session is no longer valid (expired/logged out elsewhere), go back to guest mode
const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = typeof args[0] === 'string' ? args[0] : '';
    const isAuthCall = /^\/api\/(login|signup|me|logout)/.test(url);
    if (response.status === 401 && url.startsWith('/api/') && !isAuthCall &&
        currentUser && currentUser.role !== 'guest') {
        logout(true);
        showToast('Your session expired. Please log in again.', 'error');
    }
    return response;
};

// Calendar starts on the current month (first day of this month, in the viewer's local time)
const _now = new Date();
let currentDate = new Date(_now.getFullYear(), _now.getMonth(), 1);

// Current Session State
let currentUser = {
    email: "",
    displayName: "",
    role: "guest",
    avatar: "https://via.placeholder.com/80",
    id: null
};

// Active Bookings Database Array
let activeProposals = [];

document.addEventListener("DOMContentLoaded", () => {
    // 1. Theme: use the saved choice if there is one, otherwise follow the system's light/dark setting
    const savedTheme = localStorage.getItem('suave_theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', initialTheme);

    // Only follow the system theme automatically until the person picks one explicitly in Settings
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (localStorage.getItem('suave_theme')) return;
        const newTheme = e.matches ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
    });

    if (window.lucide) {
        lucide.createIcons();
    }

    // Close mobile sidebar drawer when tapping the overlay / outside the sidebar
    document.addEventListener('click', (e) => {
        const container = document.getElementById('appContainer');
        if (!container || !container.classList.contains('mobile-open')) return;

        // Ignore taps inside the sidebar or on any burger/toggle button
        if (e.target.closest('sidebar') || e.target.closest('.icon-btn')) return;

        container.classList.remove('mobile-open');
    });

    // Reset the mobile drawer state when resizing up to desktop width
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            const container = document.getElementById('appContainer');
            if (container) container.classList.remove('mobile-open');
        }
    });

    // 2. Restore login session from localStorage if available
    const savedUser = localStorage.getItem('suave_current_user');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            updateHeaderForLoggedIn();
        } catch (e) {
            console.error("Failed to parse saved session", e);
            localStorage.removeItem('suave_current_user');
        }
    }

    // 3. Render calendar and fetch bookings from MySQL backend
    renderCalendar();

    // Confirm the saved login with the server first (the server decides who you are, not localStorage)
    verifySession().finally(() => {
        fetchProposalsFromDB();

        // 4. Reopen the tab the user was on before the refresh
        restoreViewFromHash();

        // Show the matching access-code box in case the signup form keeps a non-default role selected
        toggleStaffCode();

        // Keep the proposal date picker from offering dates outside the allowed range
        applyProposalDateLimits();
    });

    // If this page load came from clicking an email verification link, show the result
    showVerificationResultFromUrl();
});

function showVerificationResultFromUrl() {
    const params = new URLSearchParams(location.search);
    const verified = params.get('verified');
    if (!verified) return;

    if (verified === '1') {
        showToast('Email verified! You can now log in.');
        openModal('loginModal');
    } else if (verified === 'already') {
        showToast('This account is already verified. You can log in.');
        openModal('loginModal');
    } else {
        showToast('That verification link is invalid or has expired.', 'error');
    }

    // Remove ?verified=... from the address bar without affecting the current tab (#hash)
    const url = new URL(location.href);
    url.searchParams.delete('verified');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
}

// Asks the server who is logged in. The role it returns is the one that counts.
async function verifySession() {
    try {
        const response = await fetch('/api/me');
        if (response.ok) {
            const data = await response.json();
            currentUser = {
                id: data.user.id,
                email: data.user.email,
                displayName: data.user.displayName,
                role: data.user.role,
                avatar: data.user.avatar || "https://via.placeholder.com/80"
            };
            localStorage.setItem('suave_current_user', JSON.stringify(currentUser));
            updateHeaderForLoggedIn();
        } else if (currentUser.role !== 'guest') {
            logout(true); // saved login is no longer valid on the server
        }
    } catch (err) {
        console.error('Session check failed:', err);
    }
}

// Reads the tab name from the URL hash (e.g. #compliance) and opens it if it is allowed
function restoreViewFromHash() {
    let view = '';
    try {
        view = decodeURIComponent((location.hash || '').slice(1));
    } catch (e) {
        return;
    }

    if (!view || !document.getElementById('view-' + view)) return;

    // Logged-out visitors only have the calendar and evaluation tabs; fall back quietly
    if (currentUser.role === 'guest' && view !== 'calendar' && view !== 'evaluation' && view !== 'about') return;

    switchView(view);
}

// Custom Theme-Aware Toast Notification Popup
function showToast(message, type = 'success') {
    const existingToast = document.getElementById('suave-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.id = 'suave-toast';
    toast.innerText = message;

    toast.style.position = 'fixed';
    toast.style.bottom = '30px';
    toast.style.right = '30px';
    toast.style.backgroundColor = type === 'error' ? 'var(--danger)' : 'var(--bg-secondary)';
    toast.style.color = type === 'error' ? '#ffffff' : 'var(--text-main)';
    toast.style.border = '1px solid var(--border-color)';
    toast.style.padding = '14px 22px';
    toast.style.borderRadius = '10px';
    toast.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.3)';
    toast.style.zIndex = '99999';
    toast.style.fontWeight = '600';
    toast.style.fontSize = '0.9rem';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '10px';
    toast.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Fetch Bookings from Backend API / MySQL Database
async function fetchProposalsFromDB() {
    try {
        const response = await fetch('/api/proposals');
        if (response.ok) {
            const data = await response.json();
            activeProposals = data.map(item => ({
                id: item.id,
                title: item.title,
                description: item.description,
                date: item.event_date ? item.event_date.split('T')[0] : '',
                venue: item.venue,
                status: item.status,
                rejectionReason: item.rejection_reason || '',
                googleFormUrl: item.google_form_url || '',
                maxParticipants: item.max_participants || 50,
                currentRegistered: item.current_registered || 0,
                complianceStatus: item.compliance_status || 'N/A',
                cleanlinessProof: item.cleanliness_proof || null,
                resourcesReturned: item.resources_returned === 1,
                organizationName: item.organization_name,
                proposalFile: item.proposal_file || null,
                userId: item.user_id,
                startTime: item.start_time ? String(item.start_time).slice(0, 5) : '',
                endTime: item.end_time ? String(item.end_time).slice(0, 5) : '',
                submittedBy: item.submitted_by || '',
                complianceSubmittedAt: item.compliance_submitted_at || null,
                equipmentChecklist: parseChecklist(item.equipment_checklist),
                complianceRemarks: item.compliance_remarks || '',
                complianceVerifiedAt: item.compliance_verified_at || null,
                verifiedByName: item.verified_by_name || ''
            }));
            renderCalendar();
            renderProposalsTable();
            renderComplianceView();
        }
    } catch (err) {
        console.error('Failed to load bookings from database:', err);
    }
}

// Helper: Parse surname.firstname@cvsu.edu.ph into "Firstname Surname"
function formatDisplayNameFromEmail(email) {
    try {
        const handle = email.split('@')[0];
        const parts = handle.split('.');

        if (parts.length >= 2) {
            const surname = capitalizeWords(parts[0].replace(/-/g, ' '));
            const firstname = capitalizeWords(parts[1].replace(/-/g, ' '));
            return `${firstname} ${surname}`;
        }

        return capitalizeWords(handle.replace(/-/g, ' '));
    } catch (e) {
        return email;
    }
}

function capitalizeWords(str) {
    return str.replace(/\b\w/g, char => char.toUpperCase());
}

// Toggle Sidebar Collapse (Desktop) or Slide-Out Drawer (Mobile)
function toggleSidebar() {
    const container = document.getElementById('appContainer');
    if (!container) return;

    if (window.innerWidth <= 768) {
        container.classList.toggle('mobile-open');
    } else {
        container.classList.toggle('collapsed');
    }
    // Note: do NOT call lucide.createIcons() here. It replaces the tapped <i> element,
    // which breaks e.target.closest('.icon-btn') in the outside-click listener.
}

// Theme Toggle: applies immediately and is saved right away, so it survives a page refresh
function previewThemeChange(theme) {
    const html = document.documentElement;
    html.setAttribute('data-theme', theme);
    localStorage.setItem('suave_theme', theme);
    if (window.lucide) {
        lucide.createIcons();
    }
}

// View Switching Logic & Role-Based UI Adjustments
function switchView(viewName, event) {
    if (event) event.preventDefault();

    const container = document.getElementById('appContainer');
    if (container) {
        container.classList.remove('mobile-open');
    }

    if (currentUser.role === 'guest' && viewName !== 'calendar' && viewName !== 'evaluation' && viewName !== 'about') {
        showToast("Please log in or sign up to access system modules.", "error");
        openModal('loginModal');
        return;
    }

    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
    document.querySelectorAll('.sidebar-menu li').forEach(li => li.classList.remove('active'));

    const targetView = document.getElementById('view-' + viewName);
    if (targetView) targetView.classList.add('active');

    // Highlight the matching sidebar item (works for clicks, logout and restored views)
    const navLink = Array.from(document.querySelectorAll('.sidebar-menu li a'))
        .find(a => (a.getAttribute('onclick') || '').includes(`switchView('${viewName}'`));
    if (navLink) navLink.parentElement.classList.add('active');

    // Remember the current tab in the URL (#proposals etc.) so a page refresh stays on it
    try {
        history.replaceState(null, '', '#' + viewName);
    } catch (e) {
        // URL update not supported (e.g. some file:// contexts) - not critical
    }

    const titles = {
        'calendar': currentUser.role === 'guest' ? 'Event Calendar' : 'Master Calendar (Approved Events)',
        'proposals': 'Event Proposal & Approval Workflow',
        'compliance': 'Organization Compliance & Activity Log',
        'evaluation': 'System Acceptability Metrics',
        'settings': 'Account & System Settings',
        'about': 'About Us'
    };

    const titleEl = document.getElementById('current-view-title');
    if (titleEl && titles[viewName]) {
        titleEl.innerText = titles[viewName];
    }

    if (viewName === 'evaluation') {
        loadSurveyMetrics();
    }

    if (viewName === 'compliance') {
        renderComplianceView();
    }

    if (viewName === 'proposals') {
        applyProposalDateLimits();
        const createCard = document.getElementById('createProposalCard');
        const qrCard = document.getElementById('qrGeneratorCard');
        const gridContainer = document.getElementById('proposalsGridContainer');

        if (currentUser.role === 'admin' || currentUser.role === 'adviser' || currentUser.role === 'osas') {
            if (createCard) createCard.style.display = 'none';
            if (qrCard) qrCard.style.display = 'none';
            if (gridContainer) gridContainer.style.display = 'block';
        } else {
            if (createCard) createCard.style.display = 'block';
            if (qrCard) qrCard.style.display = 'block';
            if (gridContainer) gridContainer.style.display = '';
        }
    }

    if (viewName === 'settings' && currentUser.email) {
        document.getElementById('settingsDisplayName').value = currentUser.displayName;
        document.getElementById('settingsEmail').value = currentUser.email;
        document.getElementById('settingsAvatarPreview').src = currentUser.avatar;
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        document.getElementById('settingsThemeSelect').value = currentTheme;
    }
}

// Dynamic Calendar Controls
function changeMonth(delta) {
    currentDate.setMonth(currentDate.getMonth() + delta);
    renderCalendar();
}

function resetToToday() {
    const now = new Date();
    currentDate = new Date(now.getFullYear(), now.getMonth(), 1);
    renderCalendar();
}

function renderCalendar() {
    const container = document.getElementById('calendar-grid-container');
    const monthYearLabel = document.getElementById('calendar-month-year');
    if (!container || !monthYearLabel) return;

    container.innerHTML = '';

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    monthYearLabel.innerText = `${monthNames[month]} ${year}`;

    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    daysOfWeek.forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        header.innerText = day;
        container.appendChild(header);
    });

    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    for (let x = 0; x < firstDayIndex; x++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-cell disabled';
        emptyCell.style.opacity = '0.3';
        container.appendChild(emptyCell);
    }

    for (let day = 1; day <= totalDays; day++) {
        const cell = document.createElement('div');
        const isToday = (day === today.getDate() && month === today.getMonth() && year === today.getFullYear());
        cell.className = 'calendar-cell' + (isToday ? ' today' : '');
        cell.innerHTML = `<span class="day-number">${day}</span>`;

        const formattedMonth = String(month + 1).padStart(2, '0');
        const formattedDay = String(day).padStart(2, '0');
        const dateKey = `${year}-${formattedMonth}-${formattedDay}`;

        const matchedProposals = activeProposals.filter(p => p.date === dateKey && p.status === "Approved");

        if (matchedProposals.length > 0) {
            cell.style.cursor = 'pointer';
            cell.onclick = () => showEventDetails(dateKey, matchedProposals);

            matchedProposals.forEach(matchedProposal => {
                const badge = document.createElement('div');
                badge.className = 'event-tag approved';
                badge.innerText = `${matchedProposal.title} (${matchedProposal.venue})`;
                badge.title = `Click to view details for ${matchedProposal.title}`;
                cell.appendChild(badge);
            });
        }

        container.appendChild(cell);
    }
}

// Display Approved Event Details in Popup Modal
function showEventDetails(dateKey, proposals) {
    const titleEl = document.getElementById('eventModalTitle');
    const bodyEl = document.getElementById('eventModalBody');
    if (!titleEl || !bodyEl) return;

    titleEl.innerText = `Approved Events (${dateKey})`;

    let html = '';
    proposals.forEach((prop, index) => {
        let pdfLinkHtml = '';
        if (prop.proposalFile) {
            pdfLinkHtml = `<span style="font-size: 0.85rem; color: var(--text-muted);">Proposal PDF:</span> <a href="/uploads/${encodeURIComponent(prop.proposalFile)}" target="_blank" style="color: var(--primary); text-decoration: underline;">View Uploaded Document</a><br>`;
        }

        html += `
            <div style="margin-bottom: ${index < proposals.length - 1 ? '1rem' : '0'}; padding-bottom: ${index < proposals.length - 1 ? '1rem' : '0'}; border-bottom: ${index < proposals.length - 1 ? '1px solid var(--border-color)' : 'none'};">
                <strong style="font-size: 1rem; color: var(--primary); display: block; margin-bottom: 4px;">${escapeHtml(prop.title)}</strong>
                <span style="font-size: 0.85rem; color: var(--text-muted);">Organization:</span> <strong>${escapeHtml(prop.organizationName || 'N/A')}</strong><br>
                <span style="font-size: 0.85rem; color: var(--text-muted);">Venue:</span> <strong>${escapeHtml(prop.venue)}</strong><br>
                ${formatTimeRange(prop.startTime, prop.endTime) ? `<span style="font-size: 0.85rem; color: var(--text-muted);">Time:</span> <strong>${escapeHtml(formatTimeRange(prop.startTime, prop.endTime))}</strong><br>` : ''}
                ${prop.description ? `<span style="font-size: 0.85rem; color: var(--text-muted);">Description:</span> ${escapeHtml(prop.description)}<br>` : ''}
                ${prop.resourcesNeeded ? `<span style="font-size: 0.85rem; color: var(--text-muted);">Resources Needed:</span> ${escapeHtml(prop.resourcesNeeded)}<br>` : ''}
                ${pdfLinkHtml}
            </div>
        `;
    });

    bodyEl.innerHTML = html;
    openModal('eventDetailsModal');
}

// Render Proposals Table Dynamically with Multi-Tier Approval Workflow & Legacy Fallback
function renderProposalsTable() {
    const tbody = document.getElementById('proposalTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const normalizedRole = (currentUser.role || '').toLowerCase();
    const isOsasApprover = normalizedRole === 'admin' || normalizedRole === 'osas';
    const isFinalApprover = normalizedRole === 'adviser';

    activeProposals.forEach(prop => {
        const tr = document.createElement('tr');

        let badgeClass = 'badge-pending';
        let statusDisplay = prop.status;

        let effectiveStatus = prop.status;
        if (!effectiveStatus || effectiveStatus === 'Under Review' || effectiveStatus === 'Pending') {
            effectiveStatus = 'Under Review - OSAS';
        }

        if (prop.status === 'Approved') {
            badgeClass = 'badge-approved';
            statusDisplay = 'Fully Approved';
        } else if (prop.status === 'Rejected') {
            badgeClass = 'badge-rejected';
        } else if (effectiveStatus === 'Under Review - OSAS') {
            statusDisplay = 'Awaiting OSAS Review';
        } else if (effectiveStatus === 'Under Review - Adviser') {
            statusDisplay = 'OSAS Approved / Awaiting Admin';
        }

        let actionButtons = '';

        // Step 1: OSAS Approval Prerequisite
        if (effectiveStatus === 'Under Review - OSAS') {
            if (isOsasApprover) {
                actionButtons = `
                    <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px;">
                      <button class="btn" style="padding: 4px 10px; font-size: 0.75rem; background: var(--success); color: white; border: none; cursor: pointer;" onclick="updateProposalStatus(${prop.id}, 'Under Review - Adviser')">OSAS Approve</button>
                      <button class="btn" style="padding: 4px 10px; font-size: 0.75rem; background: var(--danger); color: white; border: none; cursor: pointer;" onclick="updateProposalStatus(${prop.id}, 'Rejected')">Reject</button>
                    </div>
                `;
            } else if (isFinalApprover) {
                actionButtons = `<br><small style="color: var(--warning); font-weight: 500;">Locked: Awaiting OSAS approval first.</small>`;
            }
        }
        // Step 2: Second-Tier Final Approval (Only accessible after OSAS approval)
        else if (effectiveStatus === 'Under Review - Adviser') {
            if (isFinalApprover) {
                actionButtons = `
                    <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px;">
                      <button class="btn" style="padding: 4px 10px; font-size: 0.75rem; background: var(--success); color: white; border: none; cursor: pointer;" onclick="updateProposalStatus(${prop.id}, 'Approved')">Final Approve</button>
                      <button class="btn" style="padding: 4px 10px; font-size: 0.75rem; background: var(--danger); color: white; border: none; cursor: pointer;" onclick="updateProposalStatus(${prop.id}, 'Rejected')">Reject</button>
                    </div>
                `;
            } else if (isOsasApprover) {
                actionButtons = `<br><small style="color: var(--primary); font-weight: 500;">OSAS Approved. Awaiting Admin.</small>`;
            }
        }

        let reasonHtml = '';
        if (prop.status === 'Rejected' && prop.rejectionReason) {
            reasonHtml = `<br><small style="color:var(--danger); font-weight: 500;">Reason: "${escapeHtml(prop.rejectionReason)}"</small>`;
        }

        let pdfFileLink = '';
        if (prop.proposalFile) {
            pdfFileLink = `<br><small><a href="/uploads/${encodeURIComponent(prop.proposalFile)}" target="_blank" style="color:var(--primary); text-decoration:underline;"><i data-lucide="file-text" style="width:12px; height:12px; vertical-align:middle;"></i> View PDF Proposal</a></small>`;
        }

        const timeRange = formatTimeRange(prop.startTime, prop.endTime);

        tr.innerHTML = `
          <td>
            <strong>${escapeHtml(prop.title)}</strong><br>
            <small style="color:var(--text-muted);">${escapeHtml(prop.date)}${timeRange ? ' | ' + escapeHtml(timeRange) : ''} | ${escapeHtml(prop.venue)}</small>
            ${prop.description ? `<br><small style="color:var(--text-muted); font-style:italic;">"${escapeHtml(prop.description)}"</small>` : ''}
            ${pdfFileLink}
          </td>
          <td>${escapeHtml(prop.venue)}</td>
          <td>
            <span class="badge ${badgeClass}">${statusDisplay}</span>
            ${reasonHtml}
            ${actionButtons}
          </td>
        `;
        tbody.appendChild(tr);
    });
    if (window.lucide) lucide.createIcons();
}

// Update Proposal Status (Approve / Reject triggers)
async function updateProposalStatus(id, newStatus) {
    const proposal = activeProposals.find(p => p.id === id);
    if (!proposal) return;

    if (newStatus === 'Rejected') {
        document.getElementById('rejectProposalId').value = id;
        document.getElementById('rejectReasonInput').value = '';
        openModal('rejectModal');
    } else {
        await saveProposalStatusToDB(id, newStatus, "");
    }
}

async function handleRejectSubmit(event) {
    event.preventDefault();
    const id = parseInt(document.getElementById('rejectProposalId').value);
    const reason = document.getElementById('rejectReasonInput').value.trim();

    closeModal('rejectModal');
    await saveProposalStatusToDB(id, 'Rejected', reason);
}

// Helper function to persist status change to MySQL backend
async function saveProposalStatusToDB(id, status, rejectionReason) {
    try {
        const response = await fetch(`/api/proposals/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, rejectionReason })
        });

        const data = await response.json();

        if (!response.ok) {
            showToast(data.error || 'Failed to update status.', 'error');
            return;
        }

        showToast(`Proposal status updated successfully!`);
        fetchProposalsFromDB();
    } catch (err) {
        console.error('Network error updating proposal status:', err);
        showToast('Server connection failed.', 'error');
    }
}

// Modal Controls
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('open');
    const container = document.getElementById('appContainer');
    if (container) container.classList.remove('mobile-open');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('open');
}

function switchModal(closeId, openId) {
    closeModal(closeId);
    openModal(openId);
}

// Strict @cvsu.edu.ph Validation
function validateCvSUEmail(email) {
    const cleanEmail = email.trim().toLowerCase();
    return cleanEmail.endsWith('@cvsu.edu.ph') && cleanEmail.indexOf('@') > 0;
}

// Backend-Integrated Login Handler
async function handleLogin(event) {
    event.preventDefault();
    const emailInput = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    const errorDiv = document.getElementById('loginError');

    if (!validateCvSUEmail(email)) {
        if (errorDiv) errorDiv.style.display = 'block';
        emailInput.focus();
        return;
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            if (errorDiv) {
                errorDiv.style.display = 'block';
                errorDiv.innerText = data.error || 'Invalid credentials.';
            }
            if (data.needsVerification) {
                offerResendVerification(errorDiv, email);
            }
            return;
        }

        if (errorDiv) errorDiv.style.display = 'none';

        currentUser = {
            id: data.user.id,
            email: data.user.email,
            displayName: data.user.displayName,
            role: data.user.role,
            avatar: data.user.avatar || "https://via.placeholder.com/80"
        };

        localStorage.setItem('suave_current_user', JSON.stringify(currentUser));

        closeModal('loginModal');
        updateHeaderForLoggedIn();
        fetchProposalsFromDB();
        showToast(`Welcome back, ${currentUser.displayName}!`);
    } catch (err) {
        console.error('Login network error:', err);
        showToast('Server connection failed.', 'error');
    }
}

// Adds a one-time "Resend verification email" link under a login error, so an unverified
// account isn't a dead end while waiting on an email that may not have arrived.
function offerResendVerification(errorDiv, email) {
    if (!errorDiv || errorDiv.querySelector('.resend-verification-link')) return;

    const link = document.createElement('a');
    link.href = '#';
    link.className = 'resend-verification-link';
    link.innerText = 'Resend verification email';
    link.style.display = 'inline-block';
    link.style.marginTop = '6px';
    link.style.textDecoration = 'underline';
    link.onclick = async (e) => {
        e.preventDefault();
        link.innerText = 'Sending...';
        try {
            const response = await fetch('/api/resend-verification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await response.json();
            showToast(data.message || 'If that account needs verification, a new link has been sent.');
        } catch (err) {
            console.error('Resend verification error:', err);
            showToast('Server connection failed.', 'error');
        } finally {
            link.remove();
        }
    };
    errorDiv.appendChild(document.createElement('br'));
    errorDiv.appendChild(link);
}

// Shows the matching access-code box for the role picked on the signup form
// (Organization code for Student Organization Officer, Staff code for OSAS/Admin)
function toggleStaffCode() {
    const roleSelect = document.getElementById('signupRole');
    const staffGroup = document.getElementById('signupStaffCodeGroup');
    const staffInput = document.getElementById('signupStaffCode');
    const orgGroup = document.getElementById('signupOrgCodeGroup');
    const orgInput = document.getElementById('signupOrgCode');
    if (!roleSelect || !staffGroup || !staffInput || !orgGroup || !orgInput) return;

    const isStudent = roleSelect.value === 'student';

    staffGroup.style.display = isStudent ? 'none' : 'block';
    staffInput.required = !isStudent;
    if (isStudent) staffInput.value = '';

    orgGroup.style.display = isStudent ? 'block' : 'none';
    if (!isStudent) orgInput.value = '';
    // Not marked "required": an org not using this code yet should not be unable to sign anyone up.
}

// Backend-Integrated Signup Handler
async function handleSignup(event) {
    event.preventDefault();
    const emailInput = document.getElementById('signupEmail');
    const roleSelect = document.getElementById('signupRole');
    const passwordInput = document.getElementById('signupPassword');
    const staffCodeInput = document.getElementById('signupStaffCode');
    const orgCodeInput = document.getElementById('signupOrgCode');

    const email = emailInput.value.trim().toLowerCase();
    const role = roleSelect ? roleSelect.value : "student";
    const staffCode = staffCodeInput ? staffCodeInput.value : "";
    const orgCode = orgCodeInput ? orgCodeInput.value : "";
    const password = passwordInput ? passwordInput.value : "";
    const errorDiv = document.getElementById('signupError');

    if (!validateCvSUEmail(email)) {
        if (errorDiv) errorDiv.style.display = 'block';
        emailInput.focus();
        return;
    }

    if (errorDiv) errorDiv.style.display = 'none';

    const displayName = formatDisplayNameFromEmail(email);

    try {
        const response = await fetch('/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, displayName, password, role, staffCode, orgCode })
        });

        const data = await response.json();

        if (!response.ok) {
            if (errorDiv) {
                errorDiv.style.display = 'block';
                errorDiv.innerText = data.error || 'Registration failed.';
            }
            return;
        }

        if (errorDiv) errorDiv.style.display = 'none';

        if (data.requiresVerification) {
            // Do not log the account in yet - it still needs to confirm the email first
            closeModal('signupModal');
            showToast(data.message || 'Account created! Please check your email to verify it.');
            const loginEmailInput = document.getElementById('loginEmail');
            if (loginEmailInput) loginEmailInput.value = email;
            openModal('loginModal');
            return;
        }

        // Use the account the server actually created (its role may differ from what was requested)
        currentUser = {
            id: data.user.id,
            email: data.user.email,
            displayName: data.user.displayName,
            role: data.user.role,
            avatar: data.user.avatar || "https://via.placeholder.com/80"
        };

        localStorage.setItem('suave_current_user', JSON.stringify(currentUser));

        closeModal('signupModal');
        updateHeaderForLoggedIn();
        fetchProposalsFromDB();
        showToast('Account created successfully!');
    } catch (err) {
        console.error('Signup network error:', err);
        showToast('Server connection failed.', 'error');
    }
}

// Handle Forgot Password & Recovery Code Dispatch
async function handleForgot(event) {
    event.preventDefault();
    const emailInput = document.getElementById('forgotEmail');
    const email = emailInput.value.trim().toLowerCase();
    const errorDiv = document.getElementById('forgotError');
    const submitBtn = document.getElementById('forgotSubmitBtn');

    if (!validateCvSUEmail(email)) {
        if (errorDiv) {
            errorDiv.style.display = 'block';
            errorDiv.innerText = 'Please enter a valid @cvsu.edu.ph email address.';
        }
        emailInput.focus();
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Sending Code...';
    }

    try {
        const response = await fetch('/api/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (!response.ok) {
            if (errorDiv) {
                errorDiv.style.display = 'block';
                errorDiv.innerText = data.error || 'Failed to send recovery code.';
            }
            return;
        }

        if (errorDiv) errorDiv.style.display = 'none';
        showToast(data.message || `A password recovery code has been sent to ${email}.`);
        closeModal('forgotModal');

        // Pre-fill email and open the Reset Password Modal
        const resetEmailInput = document.getElementById('resetEmail');
        if (resetEmailInput) resetEmailInput.value = email;
        const resetCodeInput = document.getElementById('resetCode');
        if (resetCodeInput) {
            resetCodeInput.value = '';
            setTimeout(() => resetCodeInput.focus(), 200);
        }
        const resetNewPass = document.getElementById('resetNewPassword');
        if (resetNewPass) resetNewPass.value = '';
        const resetConfirmPass = document.getElementById('resetConfirmPassword');
        if (resetConfirmPass) resetConfirmPass.value = '';
        const resetError = document.getElementById('resetPasswordError');
        if (resetError) resetError.style.display = 'none';

        openModal('resetPasswordModal');
    } catch (err) {
        console.error('Forgot password network error:', err);
        showToast('Server connection failed.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Send Recovery Code';
        }
    }
}

// Handle Reset Password (Verify Code & Update Password)
async function handleResetPassword(event) {
    event.preventDefault();
    const email = document.getElementById('resetEmail').value.trim().toLowerCase();
    const code = document.getElementById('resetCode').value.trim();
    const newPassword = document.getElementById('resetNewPassword').value;
    const confirmPassword = document.getElementById('resetConfirmPassword').value;
    const errorDiv = document.getElementById('resetPasswordError');
    const submitBtn = document.getElementById('resetSubmitBtn');

    if (!validateCvSUEmail(email)) {
        if (errorDiv) {
            errorDiv.style.display = 'block';
            errorDiv.innerText = 'Please enter a valid @cvsu.edu.ph email address.';
        }
        return;
    }

    if (!code || code.length !== 6) {
        if (errorDiv) {
            errorDiv.style.display = 'block';
            errorDiv.innerText = 'Please enter the 6-digit recovery code.';
        }
        return;
    }

    if (newPassword.length < 8) {
        if (errorDiv) {
            errorDiv.style.display = 'block';
            errorDiv.innerText = 'New password must be at least 8 characters.';
        }
        return;
    }

    if (newPassword !== confirmPassword) {
        if (errorDiv) {
            errorDiv.style.display = 'block';
            errorDiv.innerText = 'Passwords do not match.';
        }
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Resetting Password...';
    }

    try {
        const response = await fetch('/api/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code, newPassword })
        });

        const data = await response.json();

        if (!response.ok) {
            if (errorDiv) {
                errorDiv.style.display = 'block';
                errorDiv.innerText = data.error || 'Failed to reset password.';
            }
            return;
        }

        if (errorDiv) errorDiv.style.display = 'none';
        showToast(data.message || 'Password has been successfully reset! You can now log in.');
        closeModal('resetPasswordModal');

        // Pre-fill login modal and open it
        const loginEmail = document.getElementById('loginEmail');
        if (loginEmail) loginEmail.value = email;
        const loginPassword = document.getElementById('loginPassword');
        if (loginPassword) {
            loginPassword.value = '';
            setTimeout(() => loginPassword.focus(), 200);
        }
        openModal('loginModal');
    } catch (err) {
        console.error('Reset password network error:', err);
        showToast('Server connection failed.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Set New Password';
        }
    }
}

// Update Header & Sidebar Footer with Correct Clean Role Badges (OSAS & Admin)
function updateHeaderForLoggedIn() {
    const roleBadgeColors = {
        student: 'var(--primary)',
        adviser: 'var(--warning)',
        admin: 'var(--danger)',
        osas: 'var(--danger)'
    };

    const roleDisplayNames = {
        student: 'Student Officer',
        admin: 'OSAS',
        osas: 'OSAS',
        adviser: 'Admin'
    };

    const appContainer = document.getElementById('appContainer');
    if (appContainer) {
        appContainer.classList.remove('guest-mode');
    }

    const titleEl = document.getElementById('current-view-title');
    if (titleEl) {
        titleEl.innerText = 'Master Calendar (Approved Events)';
    }

    const actionContainer = document.getElementById('auth-header-actions');
    if (actionContainer) {
        actionContainer.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <img id="headerAvatarImg" src="${currentUser.avatar}" alt="Avatar" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 2px solid var(--primary);">
        <div style="text-align: left; line-height: 1.2;">
          <span style="font-size: 0.9rem; font-weight: 600; display: block;">${currentUser.displayName}</span>
          <span style="font-size: 0.7rem; padding: 1px 6px; border-radius: 10px; background: ${roleBadgeColors[currentUser.role] || 'var(--primary)'}; color: #ffffff; text-transform: uppercase; font-weight: 700; display: inline-block;">
            ${roleDisplayNames[currentUser.role] || currentUser.role}
          </span>
        </div>
      </div>
    `;
    }

    const sidebarFooter = document.getElementById('sidebarUserFooter');
    if (sidebarFooter) {
        sidebarFooter.style.display = 'block';
        document.getElementById('sidebarAvatarImg').src = currentUser.avatar;
        document.getElementById('sidebarFooterName').innerText = currentUser.displayName;
        document.getElementById('sidebarFooterRole').innerText = roleDisplayNames[currentUser.role] || currentUser.role;
    }

    if (window.lucide) {
        lucide.createIcons();
    }
}

function logout(silent) {
    // End the session on the server too (clears the login cookie), then reload what a guest may see
    fetch('/api/logout', { method: 'POST' }).catch(() => { }).finally(() => fetchProposalsFromDB());

    currentUser = { email: "", displayName: "", role: "guest", avatar: "https://via.placeholder.com/80", id: null };

    localStorage.removeItem('suave_current_user');

    const appContainer = document.getElementById('appContainer');
    if (appContainer) {
        appContainer.classList.remove('mobile-open');
        appContainer.classList.add('guest-mode');
    }

    const titleEl = document.getElementById('current-view-title');
    if (titleEl) {
        titleEl.innerText = 'Event Calendar';
    }

    switchView('calendar');

    const actionContainer = document.getElementById('auth-header-actions');
    if (actionContainer) {
        actionContainer.innerHTML = `
      <button class="btn" onclick="openModal('loginModal')"><i data-lucide="log-in"></i> Log In</button>
      <button class="btn btn-primary" onclick="openModal('signupModal')"><i data-lucide="user-plus"></i> Sign Up</button>
    `;
    }

    const sidebarFooter = document.getElementById('sidebarUserFooter');
    if (sidebarFooter) {
        sidebarFooter.style.display = 'none';
    }

    if (window.lucide) {
        lucide.createIcons();
    }
    renderProposalsTable();
    if (silent !== true) showToast('Logged out successfully.');
}

// Handle Settings Form Submission (Display Name, Optional Password, Optional Avatar)
async function saveSettings(event) {
    event.preventDefault();
    const newName = document.getElementById('settingsDisplayName').value.trim();
    const newPasswordEl = document.getElementById('settingsNewPassword');
    const newPassword = newPasswordEl ? newPasswordEl.value : '';
    const currentPasswordEl = document.getElementById('settingsCurrentPassword');
    const currentPassword = currentPasswordEl ? currentPasswordEl.value : '';
    const newTheme = document.getElementById('settingsThemeSelect').value;
    const avatarFileEl = document.getElementById('settingsAvatarFile');
    const avatarFile = avatarFileEl && avatarFileEl.files ? avatarFileEl.files[0] : null;

    previewThemeChange(newTheme);

    if (newPassword && !currentPassword) {
        showToast('Enter your current password to set a new one.', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('displayName', newName);
    if (newPassword) {
        formData.append('newPassword', newPassword);
        formData.append('currentPassword', currentPassword);
    }
    if (avatarFile) {
        formData.append('avatarFile', avatarFile);
    }

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            showToast(data.error || 'Failed to update settings.', 'error');
            return;
        }

        currentUser.displayName = data.user.displayName;
        if (data.user.avatar) {
            currentUser.avatar = data.user.avatar;
            const previewEl = document.getElementById('settingsAvatarPreview');
            if (previewEl) previewEl.src = currentUser.avatar;
        }
        if (newPasswordEl) newPasswordEl.value = '';
        if (currentPasswordEl) currentPasswordEl.value = '';
        if (avatarFileEl) avatarFileEl.value = '';

        localStorage.setItem('suave_current_user', JSON.stringify(currentUser));
        updateHeaderForLoggedIn();
        showToast('Settings saved to database successfully!');
    } catch (err) {
        console.error('Settings network error:', err);
        showToast('Error connecting to server.', 'error');
    }
}

// ---- User Evaluation Survey (real responses, stored in MySQL) ----
// Standard 10-item System Usability Scale (SUS)
const SUS_QUESTIONS = [
    'I think that I would like to use this system frequently.',
    'I found the system unnecessarily complex.',
    'I thought the system was easy to use.',
    'I think that I would need the support of a technical person to be able to use this system.',
    'I found the various functions in this system were well integrated.',
    'I thought there was too much inconsistency in this system.',
    'I would imagine that most people would learn to use this system very quickly.',
    'I found the system very cumbersome to use.',
    'I felt very confident using the system.',
    'I needed to learn a lot of things before I could get going with this system.'
];

// Functional suitability (completeness, correctness, appropriateness)
const FUNCTIONAL_QUESTIONS = [
    'The system provides all the functions I needed to propose, review and track events.',
    'The system gives correct results (approval routing, venue conflict detection, compliance records).',
    'The system\'s functions made my tasks easier to accomplish.',
    'The QR code generation and post-event compliance features worked as expected.'
];

function buildLikertQuestion(group, index, text) {
    const name = `${group}-${index}`;
    const options = [1, 2, 3, 4, 5].map(v =>
        `<label><input type="radio" name="${name}" value="${v}" ${v === 1 ? 'required' : ''}><span>${v}</span></label>`
    ).join('');
    return `<div class="likert-q"><p>${index + 1}. ${escapeHtml(text)}</p><div class="likert-scale">${options}</div></div>`;
}

function buildSurveyForm() {
    const container = document.getElementById('surveyQuestions');
    if (!container || container.dataset.built) return;

    container.innerHTML =
        '<h4 style="margin: 0.5rem 0;">Part A: Usability</h4>' +
        SUS_QUESTIONS.map((q, i) => buildLikertQuestion('sus', i, q)).join('') +
        '<h4 style="margin: 1.5rem 0 0.5rem;">Part B: Functional Suitability</h4>' +
        FUNCTIONAL_QUESTIONS.map((q, i) => buildLikertQuestion('fs', i, q)).join('');
    container.dataset.built = '1';
}

function isSurveyUserLoggedIn() {
    return currentUser && currentUser.id != null && currentUser.role !== 'guest';
}

async function loadSurveyMetrics() {
    buildSurveyForm();

    const loggedIn = isSurveyUserLoggedIn();
    const form = document.getElementById('surveyForm');
    const guestNote = document.getElementById('surveyGuestNote');
    const doneNote = document.getElementById('surveyDoneNote');
    if (form) form.style.display = loggedIn ? 'block' : 'none';
    if (guestNote) guestNote.style.display = loggedIn ? 'none' : 'block';

    try {
        const query = loggedIn ? `?userId=${encodeURIComponent(currentUser.id)}` : '';
        const response = await fetch('/api/survey/metrics' + query);
        if (!response.ok) return;
        const m = await response.json();

        document.getElementById('susScoreDisplay').innerText = `${m.sus} / 100`;
        document.getElementById('functionalScoreDisplay').innerText = `${m.functional}%`;

        const countText = `Based on ${m.responses} response${m.responses === 1 ? '' : 's'}`;
        document.getElementById('susResponseCount').innerText = countText;
        document.getElementById('functionalResponseCount').innerText = countText;

        if (doneNote) doneNote.style.display = loggedIn && m.hasResponded ? 'block' : 'none';
    } catch (err) {
        console.error('Failed to load survey metrics:', err);
    }
}

async function submitUXSurvey(event) {
    event.preventDefault();

    if (!isSurveyUserLoggedIn()) {
        showToast('Please log in to submit the survey.', 'error');
        return;
    }

    const read = (group, count) => Array.from({ length: count }, (_, i) => {
        const checked = document.querySelector(`input[name="${group}-${i}"]:checked`);
        return checked ? Number(checked.value) : null;
    });

    const susAnswers = read('sus', SUS_QUESTIONS.length);
    const fsAnswers = read('fs', FUNCTIONAL_QUESTIONS.length);

    if (susAnswers.includes(null) || fsAnswers.includes(null)) {
        showToast('Please answer every question.', 'error');
        return;
    }

    try {
        const response = await fetch('/api/survey', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id, susAnswers, fsAnswers })
        });
        const data = await response.json();

        if (!response.ok) {
            showToast(data.error || 'Failed to submit survey.', 'error');
            return;
        }

        showToast('Thank you! Your response was recorded.');
        document.getElementById('surveyForm').reset();
        loadSurveyMetrics();
    } catch (err) {
        console.error('Survey submit error:', err);
        showToast('Server connection failed.', 'error');
    }
}

// Dynamic Venue & Online Platform Visibility Handlers
function handleVenueChange(selectElem) {
    const onlineGroup = document.getElementById('onlinePlatformGroup');
    const otherGroup = document.getElementById('onlineOtherGroup');
    const platformSelect = document.getElementById('onlinePlatformSelect');
    const otherInput = document.getElementById('onlineOtherInput');

    if (selectElem.value === 'Online') {
        onlineGroup.style.display = 'block';
        platformSelect.required = true;
    } else {
        onlineGroup.style.display = 'none';
        otherGroup.style.display = 'none';
        platformSelect.required = false;
        platformSelect.value = '';
        otherInput.required = false;
        otherInput.value = '';
    }
}

function handlePlatformChange(selectElem) {
    const otherGroup = document.getElementById('onlineOtherGroup');
    const otherInput = document.getElementById('onlineOtherInput');

    if (selectElem.value === 'Others') {
        otherGroup.style.display = 'block';
        otherInput.required = true;
    } else {
        otherGroup.style.display = 'none';
        otherInput.required = false;
        otherInput.value = '';
    }
}

// Proposal / Booking Submission Connected to Database API with PDF Upload
// ---- Time helpers ----
function formatTime12(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${period}`;
}

function formatTimeRange(start, end) {
    return start && end ? `${formatTime12(start)} – ${formatTime12(end)}` : '';
}

// Two time ranges overlap if each starts before the other ends. Missing times = treated as all-day.
function timesOverlap(aStart, aEnd, bStart, bEnd) {
    if (!aStart || !aEnd || !bStart || !bEnd) return true;
    return aStart < bEnd && aEnd > bStart;
}

// Holds the validated proposal while the confirmation window is open
let pendingProposal = null;

// Step 1: validate the form, then open the confirmation window (nothing is sent yet)
// Proposals need at least this many days of lead time, and can't be scheduled unreasonably far out
const MIN_PROPOSAL_LEAD_DAYS = 7;
const MAX_PROPOSAL_LEAD_DAYS = 365;

// Returns a YYYY-MM-DD string for "today + days", in the viewer's local time (matches a date input's format)
function dateInputValue(daysFromToday) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromToday);
    return d.toISOString().slice(0, 10);
}

// Keeps the date picker itself from offering out-of-range dates
function applyProposalDateLimits() {
    const dateInput = document.getElementById('propDate');
    if (!dateInput) return;
    dateInput.min = dateInputValue(MIN_PROPOSAL_LEAD_DAYS);
    dateInput.max = dateInputValue(MAX_PROPOSAL_LEAD_DAYS);
}

function submitProposal(event) {
    event.preventDefault();

    const title = document.getElementById('propTitle').value.trim();
    const organizationName = document.getElementById('propOrg').value;
    const description = document.getElementById('propDescription').value.trim();
    const eventDate = document.getElementById('propDate').value;
    const startTime = document.getElementById('propStartTime').value;
    const endTime = document.getElementById('propEndTime').value;

    const minDate = dateInputValue(MIN_PROPOSAL_LEAD_DAYS);
    const maxDate = dateInputValue(MAX_PROPOSAL_LEAD_DAYS);
    if (!eventDate || eventDate < minDate) {
        showToast(`Events must be proposed at least ${MIN_PROPOSAL_LEAD_DAYS} days in advance.`, "error");
        return;
    }
    if (eventDate > maxDate) {
        showToast(`Events can't be scheduled more than ${MAX_PROPOSAL_LEAD_DAYS} days ahead.`, "error");
        return;
    }

    let venue = document.getElementById('propVenue').value;
    if (venue === 'Online') {
        const platform = document.getElementById('onlinePlatformSelect').value;
        if (!platform) {
            showToast("Please select an online platform.", "error");
            return;
        }
        if (platform === 'Others') {
            const customPlatform = document.getElementById('onlineOtherInput').value.trim();
            if (!customPlatform) {
                showToast("Please specify the online platform.", "error");
                return;
            }
            venue = `Online (${customPlatform})`;
        } else {
            venue = `Online (${platform})`;
        }
    }

    const resourcesNeeded = document.getElementById('propResources').value.trim();
    const pdfFile = document.getElementById('propPdfFile').files[0];
    const conflictError = document.getElementById('conflictError');

    if (!pdfFile) {
        showToast("Please upload the required PDF proposal document.", "error");
        return;
    }

    if (!startTime || !endTime) {
        showToast("Please set the event start and end time.", "error");
        return;
    }

    if (endTime <= startTime) {
        showToast("End time must be later than the start time.", "error");
        return;
    }

    const activeStatuses = ["Approved", "Under Review - OSAS", "Under Review - Adviser", "Under Review"];
    const hasConflict = activeProposals.some(proposal =>
        proposal.date === eventDate &&
        proposal.venue === venue &&
        activeStatuses.includes(proposal.status) &&
        timesOverlap(proposal.startTime, proposal.endTime, startTime, endTime)
    );

    if (hasConflict && !venue.startsWith('Online')) {
        if (conflictError) conflictError.style.display = 'block';
        if (window.lucide) lucide.createIcons();
        showToast("Venue conflict detected!", "error");
        return;
    }

    if (conflictError) conflictError.style.display = 'none';

    pendingProposal = {
        title, organizationName, description, eventDate, startTime, endTime,
        venue, resourcesNeeded, pdfFile
    };

    const longDate = new Date(`${eventDate}T00:00:00`).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const rows = [
        ['Event Title', title],
        ['Organization', organizationName],
        ['Date', longDate],
        ['Time', formatTimeRange(startTime, endTime)],
        ['Venue', venue],
        ['Description', description || '—'],
        ['Resources', resourcesNeeded || '—'],
        ['Proposal PDF', pdfFile.name]
    ];

    document.getElementById('confirmProposalBody').innerHTML = rows.map(([label, value]) => `
        <div style="display: flex; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--border-color);">
            <span style="flex: 0 0 100px; color: var(--text-muted); font-size: 0.85rem;">${label}</span>
            <span style="flex: 1; min-width: 0; font-weight: 500;">${escapeHtml(value)}</span>
        </div>
    `).join('');

    const confirmBtn = document.getElementById('confirmProposalBtn');
    if (confirmBtn) confirmBtn.disabled = false;
    openModal('confirmProposalModal');
}

function cancelProposalConfirmation() {
    pendingProposal = null;
    closeModal('confirmProposalModal');
}

// Step 2: the user confirmed -> actually send the proposal to the server
async function confirmProposalSubmission() {
    if (!pendingProposal) return;

    const p = pendingProposal;
    const confirmBtn = document.getElementById('confirmProposalBtn');
    if (confirmBtn) confirmBtn.disabled = true;

    const formData = new FormData();
    formData.append('title', p.title);
    formData.append('description', p.description);
    formData.append('organizationName', p.organizationName);
    formData.append('eventDate', p.eventDate);
    formData.append('startTime', p.startTime);
    formData.append('endTime', p.endTime);
    formData.append('venue', p.venue);
    formData.append('resourcesNeeded', p.resourcesNeeded);
    formData.append('userId', currentUser.id || 1);
    formData.append('pdfFile', p.pdfFile);

    try {
        const response = await fetch('/api/proposals', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        pendingProposal = null;
        closeModal('confirmProposalModal');

        if (!response.ok) {
            showToast(data.error || 'Failed to submit proposal.', "error");
            return;
        }

        showToast(`Proposal "${p.title}" submitted successfully!`);
        const form = document.getElementById('proposalForm');
        if (form) {
            form.reset();
            document.getElementById('onlinePlatformGroup').style.display = 'none';
            document.getElementById('onlineOtherGroup').style.display = 'none';
        }

        fetchProposalsFromDB();
    } catch (err) {
        console.error('Proposal submission network error:', err);
        closeModal('confirmProposalModal');
        showToast('Server connection failed.', 'error');
    } finally {
        if (confirmBtn) confirmBtn.disabled = false;
    }
}

// QR Code
function triggerQRGeneration() {
    const urlInput = document.getElementById('formUrlInput').value.trim();
    if (!urlInput) {
        showToast("Please enter a valid Google Form URL.", "error");
        return;
    }
    generateEventQRCode('qrcode-display-area', urlInput);
}

function generateEventQRCode(containerId, formUrl) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    if (typeof QRCode !== 'undefined') {
        new QRCode(container, {
            text: formUrl,
            width: 128,
            height: 128,
            colorDark: "#1e293b",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
    }
}

// After-Event Compliance
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

// Shows the student form OR the OSAS/Admin review table, depending on the logged-in role
function parseChecklist(raw) {
    try {
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

// Splits the "Resources Needed" text from a proposal into individual items
// Phrases that mean "no equipment was requested" rather than a real item to check off
const NO_RESOURCES_PHRASES = new Set([
    'none', 'none.', 'n/a', 'na', 'n.a', 'n.a.', 'nil', 'nil.', 'null', '-', '--', '—',
    'none needed', 'no resources', 'no resources needed', 'no equipment', 'no equipment needed',
    'not applicable', 'wala', 'wala po'
]);

function parseResourceItems(text) {
    return String(text || '')
        .split(/[\n,;]+/)
        .map(t => t.trim())
        .filter(Boolean)
        .filter(item => !NO_RESOURCES_PHRASES.has(item.toLowerCase()))
        .slice(0, 30);
}

// Shows the student form OR the OSAS/Admin review table, depending on the logged-in role
function renderComplianceView() {
    const formCard = document.getElementById('complianceFormCard');
    const myCard = document.getElementById('complianceMyCard');
    const reviewCard = document.getElementById('complianceReviewCard');
    if (!formCard || !reviewCard || !myCard) return;

    const role = (currentUser.role || '').toLowerCase();
    const isReviewer = role === 'admin' || role === 'adviser' || role === 'osas';

    formCard.style.display = isReviewer ? 'none' : 'block';
    reviewCard.style.display = isReviewer ? 'block' : 'none';

    if (isReviewer) {
        myCard.style.display = 'none';
        renderComplianceTable();
    } else {
        populateComplianceEventSelect();
        renderEquipmentChecklist();
        renderMyComplianceList();
        updateComplianceSubmitState();
    }
}

function renderComplianceTable() {
    const tbody = document.getElementById('complianceTableBody');
    if (!tbody) return;

    const submissions = activeProposals.filter(p => p.cleanlinessProof);

    if (submissions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted); padding: 1.5rem;">No compliance submissions yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = submissions.map(p => {
        const submittedOn = p.complianceSubmittedAt ? new Date(p.complianceSubmittedAt).toLocaleString() : '—';
        const proofUrl = `/uploads/${encodeURIComponent(p.cleanlinessProof)}`;

        const checklistHtml = p.equipmentChecklist.length
            ? p.equipmentChecklist.map(entry => {
                const ok = entry.status === 'Returned';
                const icon = ok ? '✓' : (entry.status === 'Damaged' ? '⚠' : '✗');
                return `<div style="font-size: 0.8rem; color: ${ok ? 'var(--success)' : 'var(--danger)'};">${icon} ${escapeHtml(entry.item)}${ok ? '' : ` (${escapeHtml(entry.status)})`}</div>`;
            }).join('')
            : '<small style="color: var(--text-muted);">No equipment requested</small>';

        const verified = p.complianceStatus === 'Verified';
        const verificationHtml = verified
            ? `<span class="badge badge-approved">Verified</span><br>
               <small style="color: var(--text-muted);">by ${escapeHtml(p.verifiedByName || 'staff')}<br>${escapeHtml(p.complianceVerifiedAt ? new Date(p.complianceVerifiedAt).toLocaleString() : '')}</small>`
            : `<span class="badge badge-pending">Awaiting verification</span><br>
               <button class="btn btn-primary" style="margin-top: 6px; padding: 4px 12px; width: auto; font-size: 0.8rem;" onclick="verifyCompliance(${Number(p.id)})">Verify</button>`;

        return `
          <tr>
            <td>
              <strong>${escapeHtml(p.title)}</strong><br>
              <small style="color:var(--text-muted);">${escapeHtml(p.organizationName)} | ${escapeHtml(p.date)} | ${escapeHtml(p.venue)}</small>
            </td>
            <td>${escapeHtml(p.submittedBy || 'Unknown')}<br><small style="color: var(--text-muted);">${escapeHtml(submittedOn)}</small></td>
            <td>${checklistHtml}</td>
            <td>
              <a href="${proofUrl}" target="_blank" rel="noopener">
                <img src="${proofUrl}" alt="Cleanliness proof for ${escapeHtml(p.title)}"
                     style="width: 64px; height: 64px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-color);">
              </a>
            </td>
            <td>${p.complianceRemarks ? escapeHtml(p.complianceRemarks) : '<small style="color: var(--text-muted);">—</small>'}</td>
            <td>${verificationHtml}</td>
          </tr>`;
    }).join('');
}

// OSAS / Admin sign-off on a compliance submission
async function verifyCompliance(bookingId) {
    if (!confirm('Mark this compliance submission as verified?\n\nConfirm that you have checked the cleanliness photo and the equipment checklist.')) {
        return;
    }

    try {
        const response = await fetch(`/api/compliance/${bookingId}/verify`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id })
        });
        const data = await response.json();

        if (!response.ok) {
            showToast(data.error || 'Failed to verify compliance.', 'error');
            return;
        }

        showToast('Compliance verified.');
        await fetchProposalsFromDB();
    } catch (err) {
        console.error('Verify compliance error:', err);
        showToast('Server connection failed.', 'error');
    }
}

// Student dropdown: only their own approved events that have no compliance submission yet
function populateComplianceEventSelect() {
    const select = document.getElementById('complianceEventSelect');
    const hint = document.getElementById('complianceEventHint');
    if (!select) return;

    const previous = select.value;
    const eligible = activeProposals.filter(p =>
        p.status === 'Approved' &&
        !p.cleanlinessProof &&
        currentUser.id != null &&
        String(p.userId) === String(currentUser.id)
    );

    select.innerHTML = '<option value="" disabled selected>Select your approved event</option>' +
        eligible.map(p =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)} (${escapeHtml(p.date)})</option>`
        ).join('');

    if (previous && eligible.some(p => String(p.id) === previous)) {
        select.value = previous;
    }

    if (hint) {
        hint.innerText = eligible.length === 0
            ? 'You have no approved events awaiting compliance submission.'
            : '';
    }
}

// Builds the per-item checklist from the selected event's "Resources Needed"
function renderEquipmentChecklist() {
    const group = document.getElementById('equipmentChecklistGroup');
    const container = document.getElementById('equipmentChecklist');
    const select = document.getElementById('complianceEventSelect');
    if (!group || !container || !select) return;

    if (!select.value) {
        group.style.display = 'none';
        container.innerHTML = '';
        container.dataset.booking = '';
        return;
    }

    const proposal = activeProposals.find(p => String(p.id) === select.value);
    const items = parseResourceItems(proposal ? proposal.resourcesNeeded : '');

    // Keep what the student already picked if the same event is re-rendered
    const previous = container.dataset.booking === select.value
        ? Array.from(container.querySelectorAll('select')).map(s => s.value)
        : [];

    group.style.display = 'block';
    container.dataset.booking = select.value;

    if (items.length === 0) {
        container.innerHTML = '<small style="color: var(--text-muted);">No equipment was requested for this event.</small>';
        return;
    }

    container.innerHTML = items.map((item, i) => `
        <div class="equip-row">
            <span>${escapeHtml(item)}</span>
            <select class="form-control" id="equipStatus-${i}" required>
                <option value="" disabled selected>Condition</option>
                <option value="Returned">Returned</option>
                <option value="Damaged">Damaged</option>
                <option value="Missing">Missing</option>
            </select>
        </div>
    `).join('');

    previous.forEach((value, i) => {
        const el = document.getElementById(`equipStatus-${i}`);
        if (el && value) el.value = value;
    });
}

// Student: status of their own compliance submissions
function renderMyComplianceList() {
    const card = document.getElementById('complianceMyCard');
    const list = document.getElementById('complianceMyList');
    if (!card || !list) return;

    const mine = activeProposals.filter(p =>
        p.cleanlinessProof && currentUser.id != null && String(p.userId) === String(currentUser.id)
    );

    card.style.display = mine.length ? 'block' : 'none';

    list.innerHTML = mine.map(p => {
        const verified = p.complianceStatus === 'Verified';
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
            <div style="min-width: 0; overflow-wrap: anywhere;">
              <strong>${escapeHtml(p.title)}</strong><br>
              <small style="color: var(--text-muted);">Submitted ${escapeHtml(p.complianceSubmittedAt ? new Date(p.complianceSubmittedAt).toLocaleString() : '')}</small>
            </div>
            <span class="badge ${verified ? 'badge-approved' : 'badge-pending'}" style="flex-shrink: 0;">${verified ? 'Verified' : 'Awaiting verification'}</span>
          </div>`;
    }).join('');
}

// Submit button stays disabled until the certification checkbox is ticked
function updateComplianceSubmitState() {
    const checkbox = document.getElementById('returnCheck');
    const btn = document.getElementById('complianceSubmitBtn');
    if (btn && checkbox) btn.disabled = !checkbox.checked;
}

async function submitComplianceProof(event) {
    event.preventDefault();

    const select = document.getElementById('complianceEventSelect');
    const fileInput = document.getElementById('proofFile');
    const returnCheckbox = document.getElementById('returnCheck');
    const remarksInput = document.getElementById('complianceRemarks');
    const btn = document.getElementById('complianceSubmitBtn');

    if (!select || !select.value) {
        showToast("Error: Select the event you are submitting for.", "error");
        return;
    }

    const proposal = activeProposals.find(p => String(p.id) === select.value);
    const items = parseResourceItems(proposal ? proposal.resourcesNeeded : '');
    const statuses = items.map((_, i) => {
        const el = document.getElementById(`equipStatus-${i}`);
        return el ? el.value : '';
    });

    if (statuses.some(value => !value)) {
        showToast("Error: Set the condition of every item on the equipment checklist.", "error");
        return;
    }

    if (!fileInput || fileInput.files.length === 0) {
        showToast("Error: Upload venue cleanliness proof.", "error");
        return;
    }

    if (!returnCheckbox || !returnCheckbox.checked) {
        showToast("Error: You must tick the certification statement.", "error");
        return;
    }

    const formData = new FormData();
    formData.append('bookingId', select.value);
    formData.append('userId', currentUser.id);
    formData.append('certified', 'true');
    formData.append('checklist', JSON.stringify(statuses));
    formData.append('remarks', remarksInput ? remarksInput.value.trim() : '');
    formData.append('proofFile', fileInput.files[0]);

    if (btn) btn.disabled = true;

    try {
        const response = await fetch('/api/compliance', { method: 'POST', body: formData });
        const data = await response.json();

        if (!response.ok) {
            showToast(data.error || 'Failed to submit compliance.', 'error');
            updateComplianceSubmitState();
            return;
        }

        showToast("Compliance documents submitted successfully!");
        document.getElementById('complianceForm').reset();
        await fetchProposalsFromDB();
        updateComplianceSubmitState();
    } catch (err) {
        console.error('Compliance submit error:', err);
        showToast('Server connection failed.', 'error');
        updateComplianceSubmitState();
    }
}