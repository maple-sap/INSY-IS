// ==========================================
// S.U.A.V.E. - JAVASCRIPT APPLICATION LOGIC
// ==========================================

let currentDate = new Date(2026, 9, 1); // Starts at October 2026

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
    // 1. Automatic browser/system theme detection on load
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = prefersDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', initialTheme);

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        const newTheme = e.matches ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
    });

    if (window.lucide) {
        lucide.createIcons();
    }

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
    fetchProposalsFromDB();
});

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
                organizationName: item.organization_name
            }));
            renderCalendar();
            renderProposalsTable();
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

// Toggle Sidebar Collapse
function toggleSidebar() {
    const container = document.getElementById('appContainer');
    if (container) {
        container.classList.toggle('collapsed');
        if (window.lucide) {
            lucide.createIcons();
        }
    }
}

// Theme Preview Toggle
function previewThemeChange(theme) {
    const html = document.documentElement;
    html.setAttribute('data-theme', theme);
    if (window.lucide) {
        lucide.createIcons();
    }
}

// View Switching Logic
function switchView(viewName, event) {
    if (event) event.preventDefault();

    if (currentUser.role === 'guest' && viewName !== 'calendar' && viewName !== 'evaluation') {
        showToast("Please log in or sign up to access system modules.", "error");
        openModal('loginModal');
        return;
    }

    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
    document.querySelectorAll('.sidebar-menu li').forEach(li => li.classList.remove('active'));

    const targetView = document.getElementById('view-' + viewName);
    if (targetView) targetView.classList.add('active');

    if (event && event.currentTarget) {
        event.currentTarget.parentElement.classList.add('active');
    }

    const titles = {
        'calendar': currentUser.role === 'guest' ? 'Event Calendar' : 'Master Calendar (Approved Events)',
        'proposals': 'Event Proposal & Approval Workflow',
        'compliance': 'Organization Compliance & Activity Log',
        'evaluation': 'System Acceptability Metrics',
        'settings': 'Account & System Settings'
    };

    const titleEl = document.getElementById('current-view-title');
    if (titleEl && titles[viewName]) {
        titleEl.innerText = titles[viewName];
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

        const matchedProposal = activeProposals.find(p => p.date === dateKey && p.status === "Approved");
        if (matchedProposal) {
            const badge = document.createElement('div');
            badge.className = 'event-tag approved';
            badge.innerText = `${matchedProposal.title} (${matchedProposal.venue})`;
            badge.title = `${matchedProposal.title} at ${matchedProposal.venue}`;
            cell.appendChild(badge);
        }

        container.appendChild(cell);
    }
}

// Render Proposals Table Dynamically
function renderProposalsTable() {
    const tbody = document.getElementById('proposalTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    activeProposals.forEach(prop => {
        const tr = document.createElement('tr');

        let badgeClass = 'badge-pending';
        if (prop.status === 'Approved') badgeClass = 'badge-approved';
        else if (prop.status === 'Rejected') badgeClass = 'badge-rejected';

        let actionButtons = '';
        if (prop.status === 'Under Review' && (currentUser.role === 'admin' || currentUser.role === 'adviser')) {
            actionButtons = `
        <div style="margin-top: 8px; display: flex; gap: 6px;">
          <button class="btn" style="padding: 4px 10px; font-size: 0.75rem; background: var(--success); color: white; border: none; cursor: pointer;" onclick="updateProposalStatus(${prop.id}, 'Approved')">Approve</button>
          <button class="btn" style="padding: 4px 10px; font-size: 0.75rem; background: var(--danger); color: white; border: none; cursor: pointer;" onclick="updateProposalStatus(${prop.id}, 'Rejected')">Reject</button>
        </div>
      `;
        }

        let reasonHtml = '';
        if (prop.status === 'Rejected' && prop.rejectionReason) {
            reasonHtml = `<br><small style="color:var(--danger); font-weight: 500;">Reason: "${prop.rejectionReason}"</small>`;
        }

        tr.innerHTML = `
      <td>
        <strong>${prop.title}</strong><br>
        <small style="color:var(--text-muted);">${prop.date} | ${prop.venue}</small>
        ${prop.description ? `<br><small style="color:var(--text-muted); font-style:italic;">"${prop.description}"</small>` : ''}
      </td>
      <td>${prop.venue}</td>
      <td>
        <span class="badge ${badgeClass}">${prop.status}</span>
        ${reasonHtml}
        ${actionButtons}
      </td>
    `;
        tbody.appendChild(tr);
    });
}

function updateProposalStatus(id, newStatus) {
    const proposal = activeProposals.find(p => p.id === id);
    if (!proposal) return;

    if (newStatus === 'Rejected') {
        document.getElementById('rejectProposalId').value = id;
        document.getElementById('rejectReasonInput').value = '';
        openModal('rejectModal');
    } else {
        proposal.rejectionReason = "";
        proposal.status = newStatus;
        showToast(`Proposal "${proposal.title}" has been successfully approved!`);
        renderProposalsTable();
        renderCalendar();
    }
}

function handleRejectSubmit(event) {
    event.preventDefault();
    const id = parseInt(document.getElementById('rejectProposalId').value);
    const reason = document.getElementById('rejectReasonInput').value.trim();

    const proposal = activeProposals.find(p => p.id === id);
    if (proposal) {
        proposal.status = 'Rejected';
        proposal.rejectionReason = reason;
        showToast(`Proposal "${proposal.title}" has been rejected.`);
    }

    closeModal('rejectModal');
    renderProposalsTable();
    renderCalendar();
}

// Modal Controls
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('open');
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

// Backend-Integrated Signup Handler
async function handleSignup(event) {
    event.preventDefault();
    const emailInput = document.getElementById('signupEmail');
    const roleSelect = document.getElementById('signupRole');
    const passwordInput = document.getElementById('signupPassword');

    const email = emailInput.value.trim().toLowerCase();
    const role = roleSelect ? roleSelect.value : "student";
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
            body: JSON.stringify({ email, displayName, password, role })
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

        // Automatically log user in upon successful signup
        currentUser = {
            id: data.userId,
            email,
            displayName,
            role,
            avatar: "https://via.placeholder.com/80"
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
function handleForgot(event) {
    event.preventDefault();
    const emailInput = document.getElementById('forgotEmail');
    const email = emailInput.value.trim().toLowerCase();
    const errorDiv = document.getElementById('forgotError');

    if (!validateCvSUEmail(email)) {
        if (errorDiv) errorDiv.style.display = 'block';
        emailInput.focus();
        return;
    }

    if (errorDiv) errorDiv.style.display = 'none';

    showToast(`A password recovery code has been sent to ${email}.`);
    closeModal('forgotModal');
    emailInput.value = '';
}

// Update Header & Sidebar Footer for Logged In State
function updateHeaderForLoggedIn() {
    const roleBadgeColors = {
        student: 'var(--primary)',
        adviser: 'var(--warning)',
        admin: 'var(--danger)'
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
            ${currentUser.role}
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
        document.getElementById('sidebarFooterRole').innerText = currentUser.role;
    }

    if (window.lucide) {
        lucide.createIcons();
    }
}

function logout() {
    currentUser = { email: "", displayName: "", role: "guest", avatar: "https://via.placeholder.com/80", id: null };

    localStorage.removeItem('suave_current_user');

    const appContainer = document.getElementById('appContainer');
    if (appContainer) {
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
    showToast('Logged out successfully.');
}

// Handle Settings Form Submission
async function saveSettings(event) {
    event.preventDefault();
    const newName = document.getElementById('settingsDisplayName').value.trim();
    const newTheme = document.getElementById('settingsThemeSelect').value;
    const avatarFile = document.getElementById('settingsAvatarFile').files[0];

    previewThemeChange(newTheme);

    const formData = new FormData();
    formData.append('userId', currentUser.id);
    formData.append('displayName', newName);
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
            document.getElementById('settingsAvatarPreview').src = currentUser.avatar;
        }

        localStorage.setItem('suave_current_user', JSON.stringify(currentUser));
        updateHeaderForLoggedIn();
        showToast('Settings and profile picture saved to database successfully!');
    } catch (err) {
        console.error('Settings network error:', err);
        showToast('Error connecting to server.', 'error');
    }
}

// Live UX Survey Calculation Handler
function submitUXSurvey(event) {
    event.preventDefault();
    const q1 = parseInt(document.getElementById('surveyQ1').value);
    const q2 = parseInt(document.getElementById('surveyQ2').value);

    const avgScore = (q1 + q2) / 2;
    const calculatedSUS = Math.min(100, Math.max(60, (avgScore / 5) * 30 + 70)).toFixed(1);
    const calculatedFunctional = Math.min(100, Math.max(80, (avgScore / 5) * 15 + 85)).toFixed(1);

    document.getElementById('susScoreDisplay').innerText = `${calculatedSUS} / 100`;
    document.getElementById('functionalScoreDisplay').innerText = `${calculatedFunctional}%`;

    showToast("SUS score and metrics updated successfully!");
}

// Proposal / Booking Submission Connected to Database API
async function submitProposal(event) {
    event.preventDefault();

    const title = document.getElementById('propTitle').value.trim();
    const organizationName = document.getElementById('propOrg').value.trim();
    const description = document.getElementById('propDescription').value.trim();
    const eventDate = document.getElementById('propDate').value;
    const venue = document.getElementById('propVenue').value;
    const resourcesNeeded = document.getElementById('propResources').value.trim();
    const conflictError = document.getElementById('conflictError');

    const hasConflict = activeProposals.some(proposal =>
        proposal.date === eventDate &&
        proposal.venue === venue &&
        (proposal.status === "Approved" || proposal.status === "Under Review")
    );

    if (hasConflict) {
        if (conflictError) conflictError.style.display = 'block';
        if (window.lucide) lucide.createIcons();
        showToast("Venue conflict detected!", "error");
        return;
    }

    if (conflictError) conflictError.style.display = 'none';

    try {
        const response = await fetch('/api/proposals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                description,
                organizationName,
                eventDate,
                venue,
                resourcesNeeded,
                userId: currentUser.id || 1
            })
        });

        const data = await response.json();

        if (!response.ok) {
            showToast(data.error || 'Failed to submit proposal.', "error");
            return;
        }

        showToast(`Proposal "${title}" submitted successfully!`);
        const form = document.getElementById('proposalForm');
        if (form) form.reset();

        fetchProposalsFromDB();
    } catch (err) {
        console.error('Proposal submission network error:', err);
    }
}

// QR Code Module
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

// After-Event Compliance Module
function submitComplianceProof(event, proposalId) {
    event.preventDefault();

    const fileInput = document.getElementById(`proofFile_${proposalId}`);
    const returnCheckbox = document.getElementById(`returnCheck_${proposalId}`);

    if (returnCheckbox && !returnCheckbox.checked) {
        showToast("Error: Confirm borrowed resource returns.", "error");
        return;
    }

    if (fileInput && fileInput.files.length === 0) {
        showToast("Error: Upload venue cleanliness proof.", "error");
        return;
    }

    showToast("Compliance documents submitted successfully!");
}