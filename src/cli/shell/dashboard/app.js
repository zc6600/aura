let allEvents = [];
    let activeFilter = 'all';
    let currentRawDiff = '';
    let eventSource = null;

    function escapeHTML(str) {
      if (typeof str !== 'string') return String(str || '');
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function formatBytes(bytes) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    window.addEventListener('DOMContentLoaded', () => {
      fetchStatus();
      loadSessions();
      startSSESubscription();
      fetchDiff();
    });

    function fetchStatus() {
      fetch('/api/status')
        .then(res => res.json())
        .then(data => {
          if (data.error) return;
          document.getElementById('workspace-name').textContent = data.project_name || 'Aura Project';
          document.getElementById('db-session-name').textContent = data.session_name || 'default';
          document.getElementById('sidebar-model-badge').textContent = data.model || 'Unknown';
          document.getElementById('sidebar-model-badge').title = data.model || '';

          document.getElementById('stat-project-name').textContent = data.project_name || '-';
          document.getElementById('stat-project-path').textContent = data.project_path || '-';
          document.getElementById('stat-session-name').textContent = data.session_name || '-';
          document.getElementById('stat-db-size').textContent = formatBytes(data.db_size) || '-';
          document.getElementById('stat-provider').textContent = data.provider || '-';
          document.getElementById('stat-model').textContent = data.model || '-';
          document.getElementById('stat-temp').textContent = data.temperature !== undefined ? data.temperature : '-';
          document.getElementById('stat-total-events').textContent = data.total_events || '0';
          document.getElementById('stat-total-sessions').textContent = data.total_sessions || '0';
          document.getElementById('stat-aura-version').textContent = data.version || '-';
          document.getElementById('stat-ruby-version').textContent = data.node_version || '-';
        })
        .catch(err => console.error('Error loading system status:', err));
    }

    function loadSessions() {
      const sessionSelect = document.getElementById('session-select');
      fetch('/api/sessions')
        .then(res => res.json())
        .then(data => {
          const currentVal = sessionSelect.value;
          sessionSelect.innerHTML = '<option value="">Live Stream</option>';
          
          if (data.sessions && Array.isArray(data.sessions)) {
            data.sessions.forEach(id => {
              const option = document.createElement('option');
              option.value = id;
              option.textContent = 'Phase: ' + id;
              sessionSelect.appendChild(option);
            });
          }
          sessionSelect.value = currentVal;
        })
        .catch(err => console.error('Error loading sessions:', err));
    }

    function loadSessionEvents() {
      const sessionSelect = document.getElementById('session-select');
      const sessionId = sessionSelect.value;
      const timeline = document.getElementById('timeline');
      
      if (!sessionId) {
        clearConsole();
        timeline.innerHTML = '<div class="no-events-msg">Re-establishing live stream...</div>';
        startSSESubscription();
        return;
      }

      stopSSESubscription();
      updateConnectionState(false, 'Filtered View');

      timeline.innerHTML = '<div class="no-events-msg">Loading session logs...</div>';
      allEvents = [];

      fetch('/api/sessions/' + sessionId)
        .then(res => res.json())
        .then(data => {
          timeline.innerHTML = '';
          if (data.events && Array.isArray(data.events)) {
            data.events.forEach(evt => {
              let parsedEvt = evt;
              if (typeof evt === 'string') {
                try {
                  parsedEvt = JSON.parse(evt);
                } catch (e) {
                  parsedEvt = { phase: 'system', message: evt };
                }
              }
              allEvents.push(parsedEvt);
            });
          }
          renderAllEvents();
        })
        .catch(err => {
          timeline.innerHTML = '<div class="no-events-msg">Error loading events: ' + escapeHTML(err.message) + '</div>';
        });
    }

    function startSSESubscription() {
      if (eventSource) {
        eventSource.close();
      }

      updateConnectionState(false, 'Connecting...');
      eventSource = new EventSource('/sse');
      
      eventSource.onopen = () => {
        updateConnectionState(true, 'Streaming Logs');
        const timeline = document.getElementById('timeline');
        if (allEvents.length === 0) {
          timeline.innerHTML = '';
        }
      };

      eventSource.onmessage = (e) => {
        const sessionSelect = document.getElementById('session-select');
        if (sessionSelect.value !== '') return;

        const data = e.data;
        let parsedEvt = null;

        try {
          parsedEvt = JSON.parse(data);
        } catch (err) {
          parsedEvt = { phase: 'system', message: data };
        }

        addEvent(parsedEvt);
        fetchStatus();
      };

      eventSource.onerror = (err) => {
        updateConnectionState(false, 'Disconnected');
      };
    }

    function stopSSESubscription() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    }

    function updateConnectionState(isConnected, text) {
      const dot = document.getElementById('connection-dot');
      const lbl = document.getElementById('connection-text');
      
      if (isConnected) {
        dot.className = 'status-indicator-dot connected';
      } else {
        dot.className = 'status-indicator-dot disconnected';
      }
      lbl.textContent = text;
    }

    function switchTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.id === `btn-${tabId}`);
      });

      document.querySelectorAll('.tab-content').forEach(pane => {
        pane.classList.toggle('active', pane.id === tabId);
      });

      if (tabId === 'tab-diff') {
        fetchDiff();
      } else if (tabId === 'tab-status') {
        fetchStatus();
      }
    }

    function setFilter(filterType) {
      activeFilter = filterType;
      document.querySelectorAll('.filter-pills .filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === filterType);
      });
      renderAllEvents();
    }

    function filterSearch() {
      renderAllEvents();
    }

    function matchesFilterAndSearch(evt) {
      if (activeFilter !== 'all') {
        if (evt.phase !== activeFilter) return false;
      }

      const searchText = document.getElementById('log-search').value.toLowerCase().trim();
      if (searchText === '') return true;

      const content = (evt.content || '').toLowerCase();
      const thought = (evt.thought || '').toLowerCase();
      const summary = (evt.summary || '').toLowerCase();
      const tool = (evt.tool || '').toLowerCase();
      const message = (evt.message || '').toLowerCase();
      const output = evt.result ? (evt.result.output || evt.result.error || JSON.stringify(evt.result)).toLowerCase() : '';

      return content.includes(searchText) ||
             thought.includes(searchText) ||
             summary.includes(searchText) ||
             tool.includes(searchText) ||
             message.includes(searchText) ||
             output.includes(searchText);
    }

    function addEvent(evt) {
      allEvents.push(evt);

      if (matchesFilterAndSearch(evt)) {
        const timeline = document.getElementById('timeline');
        const noEventsMsg = timeline.querySelector('.no-events-msg');
        if (noEventsMsg) {
          timeline.innerHTML = '';
        }

        const card = renderEventCard(evt);
        timeline.appendChild(card);
        
        if (document.getElementById('autoscroll-toggle').checked) {
          timeline.scrollTop = timeline.scrollHeight;
        }
      }
    }

    function renderAllEvents() {
      const timeline = document.getElementById('timeline');
      timeline.innerHTML = '';

      const filtered = allEvents.filter(matchesFilterAndSearch);

      if (filtered.length === 0) {
        timeline.innerHTML = '<div class="no-events-msg">No logs matching active search and filters.</div>';
        return;
      }

      filtered.forEach(evt => {
        const card = renderEventCard(evt);
        timeline.appendChild(card);
      });

      if (document.getElementById('autoscroll-toggle').checked) {
        timeline.scrollTop = timeline.scrollHeight;
      }
    }

    function renderEventCard(evt) {
      const card = document.createElement('div');
      card.className = `event-card event-${evt.phase || 'custom'}`;

      const time = evt.timestamp ? new Date(evt.timestamp * 1000).toLocaleTimeString() : new Date().toLocaleTimeString();

      const headerHTML = `
        <div class="event-header">
          <span class="event-badge">${escapeHTML(evt.phase ? evt.phase.toUpperCase() : 'SYSTEM')}</span>
          <span class="event-time">${time}</span>
        </div>
      `;

      if (evt.phase === 'user') {
        card.classList.add('chat-user');
        card.innerHTML = `
          <div class="user-avatar">👤</div>
          <div class="user-content">${escapeHTML(evt.content || evt.message || '')}</div>
        `;
        return card;
      }

      if (evt.phase === 'plan') {
        card.innerHTML = `
          ${headerHTML}
          <div class="plan-summary"><strong>Planned Action:</strong> ${escapeHTML(evt.summary || '')}</div>
          ${evt.thought ? `<div class="plan-thought">"${escapeHTML(evt.thought)}"</div>` : ''}
          ${evt.tool ? `<div class="plan-tool-call">Tool to execute: <span class="tool-badge">${escapeHTML(evt.tool)}</span></div>` : ''}
          ${evt.args && Object.keys(evt.args).length ? `
            <div class="collapsible-args">
              <div class="collapsible-trigger" onclick="toggleDetails(this)">▶ View Arguments</div>
              <pre class="collapsible-content"><code>${escapeHTML(JSON.stringify(evt.args, null, 2))}</code></pre>
            </div>
          ` : ''}
        `;
        return card;
      }

      if (evt.phase === 'execution') {
        const isSuccess = evt.result && evt.result.status !== 'failed';
        const statusClass = isSuccess ? 'status-success' : 'status-failed';
        const statusText = isSuccess ? 'SUCCESS' : 'FAILED';
        const output = evt.result ? (evt.result.output || evt.result.error || JSON.stringify(evt.result)) : '';

        card.innerHTML = `
          ${headerHTML}
          <div class="exec-tool-header">
            <span class="tool-badge exec-tool-name">${escapeHTML(evt.tool || '')}</span>
            <span class="status-indicator ${statusClass}">${statusText}</span>
          </div>
          <div class="collapsible-result">
            <div class="collapsible-trigger" onclick="toggleDetails(this)">▼ View Results</div>
            <pre class="collapsible-content active"><code>${escapeHTML(output)}</code></pre>
          </div>
        `;
        
        if (!isSuccess) {
          card.classList.add('failed');
        }
        return card;
      }

      if (evt.phase === 'interception') {
        card.innerHTML = `
          ${headerHTML}
          <div class="interception-banner">⚠️ AGENT ACTION INTERCEPTED</div>
          <div class="interception-advice"><strong>Guidance:</strong> ${escapeHTML(evt.advice || '')}</div>
          ${evt.reason ? `<div class="interception-reason"><strong>Reason:</strong> ${escapeHTML(evt.reason)}</div>` : ''}
        `;
        return card;
      }

      if (evt.phase === 'observe') {
        card.classList.add('observe-card');
        card.innerHTML = `
          <div class="observe-pill">
            <span class="pulse-dot-small"></span> Observing workspace changes...
          </div>
        `;
        return card;
      }

      const bodyMsg = evt.message || evt.content || (typeof evt === 'object' ? JSON.stringify(evt, null, 2) : String(evt));
      card.innerHTML = `
        ${headerHTML}
        <div style="white-space: pre-wrap; font-size: 12.5px; color: #cbd5e1;">${escapeHTML(bodyMsg)}</div>
      `;
      return card;
    }

    function toggleDetails(triggerElement) {
      const content = triggerElement.nextElementSibling;
      content.classList.toggle('active');
      const isActive = content.classList.contains('active');
      triggerElement.textContent = (isActive ? '▼' : '▶') + triggerElement.textContent.substring(1);
    }

    function clearConsole() {
      allEvents = [];
      renderAllEvents();
    }

    function fetchDiff() {
      const container = document.getElementById('diff-files-container');
      container.innerHTML = '<div class="no-events-msg"><span class="pulse-dot-small"></span> Running shadow git diff...</div>';

      fetch('/diff')
        .then(res => res.json())
        .then(data => {
          container.innerHTML = '';
          currentRawDiff = data.diff || '';

          if (!data.diff || data.diff.trim() === '' || data.diff.includes('No changes recorded')) {
            container.innerHTML = '<div class="no-diff-msg">No unstaged changes recorded in the shadow workspace.</div>';
            return;
          }

          const files = [];
          let currentFile = null;
          const lines = data.diff.split('\n');

          lines.forEach(line => {
            if (line.startsWith('diff --git ')) {
              const match = line.match(/b\/(.+)$/);
              const filename = match ? match[1] : 'Unknown File';
              currentFile = {
                name: filename,
                lines: []
              };
              files.push(currentFile);
            } else if (currentFile) {
              currentFile.lines.push(line);
            }
          });

          if (files.length === 0) {
            const rawCard = document.createElement('div');
            rawCard.className = 'diff-file-card';
            rawCard.innerHTML = `
              <div class="diff-file-header" onclick="toggleDiffCard(this)">
                <span class="arrow">▼</span>
                <span class="file-name">Raw Diff Logs</span>
              </div>
              <div class="diff-file-body">
                <pre class="diff-code"><code>${formatDiffLines(lines)}</code></pre>
              </div>
            `;
            container.appendChild(rawCard);
            return;
          }

          files.forEach(file => {
            const fileCard = document.createElement('div');
            fileCard.className = 'diff-file-card';
            
            const adds = file.lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
            const dels = file.lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;

            fileCard.innerHTML = `
              <div class="diff-file-header" onclick="toggleDiffCard(this)">
                <span class="arrow">▼</span>
                <span class="file-name">${escapeHTML(file.name)}</span>
                ${adds > 0 ? `<span class="file-badge">+${adds}</span>` : ''}
                ${dels > 0 ? `<span class="file-badge del">-${dels}</span>` : ''}
              </div>
              <div class="diff-file-body">
                <pre class="diff-code"><code>${formatDiffLines(file.lines)}</code></pre>
              </div>
            `;
            container.appendChild(fileCard);
          });
        })
        .catch(err => {
          container.innerHTML = `<div class="no-diff-msg">Error loading workspace diff: ${escapeHTML(err.message)}</div>`;
        });
    }

    function formatDiffLines(lines) {
      return lines.map(line => {
        let cls = '';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'del';
        else if (line.startsWith('@@') || line.startsWith('diff') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++')) cls = 'meta';

        return `<div class="diff-line ${cls}">${escapeHTML(line)}</div>`;
      }).join('');
    }

    function toggleDiffCard(header) {
      const card = header.parentElement;
      card.classList.toggle('collapsed');
    }

    function copyWholeDiff() {
      if (!currentRawDiff) {
        alert('No diff content to copy!');
        return;
      }
      navigator.clipboard.writeText(currentRawDiff)
        .then(() => alert('Git diff copied to clipboard!'))
        .catch(err => alert('Failed to copy diff: ' + err.message));
    }

    function exportLogs() {
      if (allEvents.length === 0) {
        alert('No logs recorded to export!');
        return;
      }
      const text = JSON.stringify(allEvents, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `aura-session-logs-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
