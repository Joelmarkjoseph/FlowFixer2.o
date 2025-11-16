/* UI Components for Message Resender Interface */

// ============ RENDER RESENDER OVERVIEW ============

function renderResenderOverview(iflowsWithFailures, credentials) {
  ensureStyles();
  const container = findMainContentContainer();
  if (!container) {
    renderResenderOverviewPanel(iflowsWithFailures, credentials);
    return;
  }
  
  let root = container.querySelector('#cpi-lite-page-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'cpi-lite-page-root';
    container.appendChild(root);
  }
  root.className = isDark() ? 'cpi-lite-dark' : '';
  root.innerHTML = '';

  const page = document.createElement('section');
  page.className = 'cpi-lite-body';
  
  // Header
  const header = document.createElement('div');
  header.className = 'cpi-lite-header';
  const back = document.createElement('button');
  back.className = 'cpi-lite-back';
  back.textContent = '← Back to Overview';
  back.onclick = () => { renderFullPage(state.cachedRows); };
  const title = document.createElement('div');
  title.className = 'cpi-lite-title';
  title.textContent = 'Message Resender - iFlows with Failed Messages';
  header.appendChild(back);
  header.appendChild(title);

  // Status bar
  const statusBar = document.createElement('div');
  statusBar.style.cssText = 'padding:12px; background:rgba(0,0,0,.03); margin:12px 0; border-radius:6px;';
  statusBar.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <span id="resender-status">Ready to fetch and resend messages</span>
      <button id="fetch-all-payloads" class="cpi-lite-btn">Fetch All Payloads</button>
    </div>
  `;

  // Table
  const table = document.createElement('table');
  table.className = 'cpi-lite-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width:50%">iFlow Name</th>
        <th style="width:15%" class="cpi-lite-count">Failed Count</th>
        <th style="width:15%" class="cpi-lite-count">Saved Payloads</th>
        <th style="width:20%">Actions</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  
  const tbody = table.querySelector('tbody');
  const fmt = n => new Intl.NumberFormat().format(n);
  
  iflowsWithFailures.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  
  for (const iflow of iflowsWithFailures) {
    const tr = document.createElement('tr');
    
    const tdName = document.createElement('td');
    tdName.textContent = iflow.name || iflow.symbolicName;
    
    const tdFailed = document.createElement('td');
    tdFailed.className = 'cpi-lite-count cpi-lite-fail';
    const failLink = document.createElement('a');
    failLink.href = '#';
    failLink.className = 'cpi-lite-link';
    failLink.textContent = fmt(iflow.failed || 0);
    failLink.onclick = (e) => {
      e.preventDefault();
      showResenderMessages(iflow.symbolicName || iflow.name, iflow.name || iflow.symbolicName, credentials);
    };
    tdFailed.appendChild(failLink);
    
    const tdSaved = document.createElement('td');
    tdSaved.className = 'cpi-lite-count';
    tdSaved.id = `saved-count-${iflow.symbolicName}`;
    tdSaved.textContent = '...';
    
    const tdActions = document.createElement('td');
    const fetchBtn = document.createElement('button');
    fetchBtn.className = 'cpi-lite-btn';
    fetchBtn.textContent = 'Fetch Payloads';
    fetchBtn.style.cssText = 'font-size:12px; padding:4px 8px;';
    fetchBtn.onclick = () => fetchPayloadsForIflow(iflow, credentials);
    tdActions.appendChild(fetchBtn);
    
    tr.appendChild(tdName);
    tr.appendChild(tdFailed);
    tr.appendChild(tdSaved);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  }

  page.appendChild(header);
  page.appendChild(statusBar);
  page.appendChild(table);
  root.appendChild(page);

  // Update saved counts
  updateSavedCounts(iflowsWithFailures);

  // Wire up fetch all button
  document.getElementById('fetch-all-payloads').onclick = () => {
    fetchAllPayloads(iflowsWithFailures, credentials);
  };
}

// ============ SHOW RESENDER MESSAGES ============

function showResenderMessages(symbolicName, displayName, credentials) {
  ensureStyles();
  const container = findMainContentContainer();
  if (!container) return;
  
  let root = container.querySelector('#cpi-lite-page-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'cpi-lite-page-root';
    container.appendChild(root);
  }
  root.className = isDark() ? 'cpi-lite-dark' : '';
  root.innerHTML = '';

  const page = document.createElement('section');
  page.className = 'cpi-lite-body';
  
  // Header
  const header = document.createElement('div');
  header.className = 'cpi-lite-header';
  const back = document.createElement('button');
  back.className = 'cpi-lite-back';
  back.textContent = '← Back';
  back.onclick = async () => {
    const iflowsWithFailures = await getFailedMessageCountsByIflow();
    renderResenderOverview(iflowsWithFailures, credentials);
  };
  const title = document.createElement('div');
  title.className = 'cpi-lite-title';
  title.textContent = `Failed Messages — ${displayName}`;
  header.appendChild(back);
  header.appendChild(title);

  // Controls
  const controls = document.createElement('div');
  controls.style.cssText = 'padding:12px; background:rgba(0,0,0,.03); margin:12px 0; border-radius:6px;';
  controls.innerHTML = `
    <div style="display:flex; gap:12px; align-items:center;">
      <button id="select-all-btn" class="cpi-lite-select-all">Select All</button>
      <button id="resend-selected-btn" class="cpi-lite-btn" disabled>Resend Selected (0)</button>
      <span id="resender-msg-status" style="margin-left:8px; color:#666;"></span>
    </div>
  `;

  // Table
  const table = document.createElement('table');
  table.className = 'cpi-lite-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width:5%"><input type="checkbox" id="select-all-checkbox" class="cpi-lite-checkbox"></th>
        <th style="width:25%">Message ID</th>
        <th style="width:10%">Status</th>
        <th style="width:15%">Log Start</th>
        <th style="width:10%">Payload</th>
        <th style="width:35%">Error</th>
      </tr>
    </thead>
    <tbody id="messages-tbody"></tbody>
  `;

  page.appendChild(header);
  page.appendChild(controls);
  page.appendChild(table);
  root.appendChild(page);

  // Load messages
  loadFailedMessages(symbolicName, displayName, credentials);
}

// ============ HELPER FUNCTIONS ============

async function updateSavedCounts(iflows) {
  const allPayloads = await getAllSavedPayloads();
  
  for (const iflow of iflows) {
    const countEl = document.getElementById(`saved-count-${iflow.symbolicName}`);
    if (countEl) {
      const saved = allPayloads[iflow.symbolicName] || [];
      countEl.textContent = saved.length.toString();
    }
  }
}

async function fetchPayloadsForIflow(iflow, credentials) {
  const statusEl = document.getElementById('resender-status');
  
  await fetchAndSaveFailedMessagesWithPayloads(
    iflow.symbolicName || iflow.name,
    credentials.resenderUsername,
    credentials.resenderPassword,
    (msg) => {
      if (statusEl) statusEl.textContent = msg;
    }
  );
  
  // Update saved count
  const allPayloads = await getAllSavedPayloads();
  const countEl = document.getElementById(`saved-count-${iflow.symbolicName}`);
  if (countEl) {
    const saved = allPayloads[iflow.symbolicName] || [];
    countEl.textContent = saved.length.toString();
  }
}

async function fetchAllPayloads(iflows, credentials) {
  const statusEl = document.getElementById('resender-status');
  
  for (let i = 0; i < iflows.length; i++) {
    const iflow = iflows[i];
    statusEl.textContent = `Processing ${i + 1}/${iflows.length}: ${iflow.name}...`;
    
    await fetchPayloadsForIflow(iflow, credentials);
  }
  
  statusEl.textContent = 'All payloads fetched successfully!';
}

async function loadFailedMessages(symbolicName, displayName, credentials) {
  const tbody = document.getElementById('messages-tbody');
  const statusEl = document.getElementById('resender-msg-status');
  
  statusEl.textContent = 'Loading failed messages...';
  
  try {
    const messages = await listFailedMessagesForIflow(symbolicName);
    const allPayloads = await getAllSavedPayloads();
    const savedPayloads = allPayloads[symbolicName] || [];
    
    tbody.innerHTML = '';
    
    for (const msg of messages) {
      const tr = document.createElement('tr');
      
      const hasSavedPayload = savedPayloads.some(p => p.messageGuid === msg.messageId);
      
      tr.innerHTML = `
        <td><input type="checkbox" class="cpi-lite-checkbox message-checkbox" data-message-id="${msg.messageId}" ${hasSavedPayload ? '' : 'disabled'}></td>
        <td style="font-family:monospace; font-size:11px;">${msg.messageId}</td>
        <td>${msg.status}</td>
        <td style="font-size:11px;">${msg.logStart ? new Date(msg.logStart).toLocaleString() : '-'}</td>
        <td>${hasSavedPayload ? '✓ Saved' : '✗ Not saved'}</td>
        <td style="font-size:11px;">${msg.errorDetails || msg.errorText || '-'}</td>
      `;
      
      tbody.appendChild(tr);
    }
    
    statusEl.textContent = `Loaded ${messages.length} failed messages`;
    
    // Wire up checkboxes
    setupCheckboxHandlers(symbolicName, credentials);
    
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  }
}

function setupCheckboxHandlers(symbolicName, credentials) {
  const selectAllCheckbox = document.getElementById('select-all-checkbox');
  const selectAllBtn = document.getElementById('select-all-btn');
  const resendBtn = document.getElementById('resend-selected-btn');
  const messageCheckboxes = document.querySelectorAll('.message-checkbox:not([disabled])');
  
  const updateResendButton = () => {
    const checkedCount = document.querySelectorAll('.message-checkbox:checked').length;
    resendBtn.textContent = `Resend Selected (${checkedCount})`;
    resendBtn.disabled = checkedCount === 0;
  };
  
  selectAllCheckbox.onchange = () => {
    messageCheckboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
    updateResendButton();
  };
  
  selectAllBtn.onclick = () => {
    const allChecked = Array.from(messageCheckboxes).every(cb => cb.checked);
    messageCheckboxes.forEach(cb => cb.checked = !allChecked);
    selectAllCheckbox.checked = !allChecked;
    updateResendButton();
  };
  
  messageCheckboxes.forEach(cb => {
    cb.onchange = updateResendButton;
  });
  
  resendBtn.onclick = async () => {
    const selectedCheckboxes = document.querySelectorAll('.message-checkbox:checked');
    const selectedMessages = Array.from(selectedCheckboxes).map(cb => ({
      messageId: cb.getAttribute('data-message-id')
    }));
    
    if (selectedMessages.length === 0) return;
    
    if (!confirm(`Resend ${selectedMessages.length} message(s)?`)) return;
    
    const statusEl = document.getElementById('resender-msg-status');
    resendBtn.disabled = true;
    
    const result = await resendSelectedMessages(
      selectedMessages,
      symbolicName,
      credentials.resenderUsername,
      credentials.resenderPassword,
      (msg) => {
        if (statusEl) statusEl.textContent = msg;
      }
    );
    
    resendBtn.disabled = false;
    
    if (result.success) {
      alert(`Successfully resent ${result.successCount}/${result.totalCount} messages`);
    } else {
      alert(`Failed to resend messages: ${result.error}`);
    }
  };
}
