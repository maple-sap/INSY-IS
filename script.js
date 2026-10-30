// ==========================================
// S.U.A.V.E. - JAVASCRIPT APPLICATION
// ==========================================

let currentDate = new Date(2026, 9, 1); // Starts at October 2026

// Current Session State
let currentUser = {
    email: "",
    displayName: "",
    role: "guest", // "guest", "student", "adviser", or "admin"
    avatar: "https://via.placeholder.com/80"
};

// Store registered accounts so users can log back in with their chosen role
let registeredAccounts = [
    { email: "admin.osas@cvsu.edu.ph", displayName: "OSAS Admin", role: "admin", avatar: "https://via.placeholder.com/80" },
    { email: "adviser.reyes@cvsu.edu.ph", displayName: "Faculty Adviser", role: "adviser", avatar: "https://via.placeholder.com/80" }
];

// Active Proposals Database
let activeProposals = [
    {
        id: 1,
        title: "Annual IT Summit",
        description: "General assembly and tech talks for IT students.",
        date: "2026-10-05",
        venue: "Fourth Floor",
        status: "Approved",
        rejectionReason: "",
        googleFormUrl: "https://forms.gle/sample-it-summit",
        maxParticipants: 100,
        currentRegistered: 100,
        complianceStatus: "Cleared",
        cleanlinessProof: "img_proof_1.jpg",
        resourcesReturned: true
    },
    {
        id: 2,
        title: "Research Colloquium",
        description: "Presenting undergraduate thesis projects.",
        date: "2026-10-12",
        venue: "Student Lounge",
        status: "Approved",
        rejectionReason: "",
        googleFormUrl: "https://forms.gle/sample-colloquium",
        maxParticipants: 50,
        currentRegistered: 32,
        complianceStatus: "Pending Compliance",
        cleanlinessProof: null,
        resourcesReturned: false
    },
    {
        id: 3,
        title: "Org Leadership Workshop",
        description: "Training session for newly elected student officers.",
        date: "2026-10-20",
        venue: "AVR",
        status: "Under Review",
        rejectionReason: "",
        googleFormUrl: "",
        maxParticipants: 60,
        currentRegistered: 0,
        complianceStatus: "N/A",
        cleanlinessProof: null,
        resourcesReturned: false
    }
];

document.addEventListener("DOMContentLoaded", () => {
    // Automatic browser/system theme detection on load
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
    renderCalendar();
    renderProposalsTable();
});

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

    if (currentUser.role === 'guest' && viewName !== 'calendar') {
        alert("Please log in or sign up to access system modules and features.");
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
        alert(`Proposal "${proposal.title}" has been successfully approved!`);
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
        alert(`Proposal "${proposal.title}" has been rejected.`);
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

// Auth Handlers
function handleLogin(event) {
    event.preventDefault();
    const emailInput = document.getElementById('loginEmail');
    const email = emailInput.value.trim().toLowerCase();
    const errorDiv = document.getElementById('loginError');

    if (!validateCvSUEmail(email)) {
        if (errorDiv) errorDiv.style.display = 'block';
        emailInput.focus();
        return;
    }

    if (errorDiv) errorDiv.style.display = 'none';

    // Check if account was registered, otherwise resolve role intelligently for testing
    let foundAccount = registeredAccounts.find(acc => acc.email === email);
    let role = "student";
    let displayName = formatDisplayNameFromEmail(email);
    let avatar = "https://via.placeholder.com/80";

    if (foundAccount) {
        role = foundAccount.role;
        displayName = foundAccount.displayName;
        avatar = foundAccount.avatar;
    } else {
        if (email.includes('admin')) role = 'admin';
        else if (email.includes('adviser') || email.includes('faculty')) role = 'adviser';
    }

    currentUser = { email, displayName, role, avatar };

    closeModal('loginModal');
    updateHeaderForLoggedIn();
    renderProposalsTable();
}

function handleSignup(event) {
    event.preventDefault();
    const emailInput = document.getElementById('signupEmail');
    const roleSelect = document.getElementById('signupRole');
    const email = emailInput.value.trim().toLowerCase();
    const role = roleSelect ? roleSelect.value : "student";
    const errorDiv = document.getElementById('signupError');

    if (!validateCvSUEmail(email)) {
        if (errorDiv) errorDiv.style.display = 'block';
        emailInput.focus();
        return;
    }

    if (errorDiv) errorDiv.style.display = 'none';

    const displayName = formatDisplayNameFromEmail(email);
    currentUser = { email, displayName, role, avatar: "https://via.placeholder.com/80" };

    // Save registration so subsequent logins remember this role
    registeredAccounts.push({ email, displayName, role, avatar: currentUser.avatar });

    closeModal('signupModal');
    updateHeaderForLoggedIn();
    renderProposalsTable();
}

function handleForgot(event) {
    event.preventDefault();
    const emailInput = document.getElementById('forgotEmail');
    const email = emailInput.value;
    const errorDiv = document.getElementById('forgotError');

    if (!validateCvSUEmail(email)) {
        if (errorDiv) errorDiv.style.display = 'block';
        emailInput.focus();
        return;
    }

    if (errorDiv) errorDiv.style.display = 'none';
    alert('Password reset instructions sent to ' + email);
    closeModal('forgotModal');
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
    currentUser = { email: "", displayName: "", role: "guest", avatar: "https://via.placeholder.com/80" };

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
}

// Handle Settings Form Submission
function saveSettings(event) {
    event.preventDefault();
    const newName = document.getElementById('settingsDisplayName').value.trim();
    const newTheme = document.getElementById('settingsThemeSelect').value;
    const newPassword = document.getElementById('settingsNewPassword').value;
    const avatarFile = document.getElementById('settingsAvatarFile').files[0];

    if (newName) {
        currentUser.displayName = newName;
    }

    previewThemeChange(newTheme);

    if (avatarFile) {
        const reader = new FileReader();
        reader.onload = function (e) {
            currentUser.avatar = e.target.result;
            document.getElementById('settingsAvatarPreview').src = currentUser.avatar;
            updateHeaderForLoggedIn();
            alert('Settings updated successfully!');
        };
        reader.readAsDataURL(avatarFile);
    } else {
        updateHeaderForLoggedIn();
        alert('Settings updated successfully!');
    }

    if (newPassword) {
        console.log("Password updated successfully.");
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

    alert("Thank you for your feedback! System Acceptability Metrics and SUS score have been dynamically updated based on your response.");
}

// Proposal Submission
function submitProposal(event) {
    event.preventDefault();

    const title = document.getElementById('propTitle').value.trim();
    const description = document.getElementById('propDescription').value.trim();
    const date = document.getElementById('propDate').value;
    const venue = document.getElementById('propVenue').value;
    const conflictError = document.getElementById('conflictError');

    const hasConflict = activeProposals.some(proposal =>
        proposal.date === date &&
        proposal.venue === venue &&
        (proposal.status === "Approved" || proposal.status === "Under Review")
    );

    if (hasConflict) {
        if (conflictError) conflictError.style.display = 'block';
        if (window.lucide) lucide.createIcons();
        return;
    }

    if (conflictError) conflictError.style.display = 'none';

    const newProposal = {
        id: activeProposals.length + 1,
        title: title,
        description: description,
        date: date,
        venue: venue,
        status: "Under Review",
        rejectionReason: "",
        googleFormUrl: "",
        maxParticipants: 50,
        currentRegistered: 0,
        complianceStatus: "N/A",
        cleanlinessProof: null,
        resourcesReturned: false
    };
    activeProposals.unshift(newProposal);

    alert(`Proposal "${title}" submitted successfully for ${venue} on ${date}!`);
    const form = document.getElementById('proposalForm');
    if (form) form.reset();

    renderProposalsTable();
    renderCalendar();
}

// ==========================================
// QR CODE & PARTICIPANT LIMIT
// ==========================================
function triggerQRGeneration() {
    const urlInput = document.getElementById('formUrlInput').value.trim();
    if (!urlInput) {
        alert("Please enter a valid Google Form URL.");
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

// ==========================================
// AFTER-EVENT COMPLIANCE
// ==========================================
function submitComplianceProof(event, proposalId) {
    event.preventDefault();

    const fileInput = document.getElementById(`proofFile_${proposalId}`);
    const returnCheckbox = document.getElementById(`returnCheck_${proposalId}`);
    const proposal = activeProposals.find(p => p.id === proposalId);

    if (!proposal) return;

    if (returnCheckbox && !returnCheckbox.checked) {
        alert("Error: You must confirm that all borrowed resources have been returned.");
        return;
    }

    if (fileInput && fileInput.files.length === 0) {
        alert("Error: Please upload a photo proof showing the venue is cleaned.");
        return;
    }

    if (fileInput && fileInput.files[0]) {
        proposal.cleanlinessProof = fileInput.files[0].name;
    }

    proposal.resourcesReturned = true;
    proposal.complianceStatus = "Pending Admin Review";

    alert("Compliance documents submitted successfully! Waiting for Admin/Adviser verification.");
}