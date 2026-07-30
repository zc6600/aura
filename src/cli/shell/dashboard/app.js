// Tinyville Showcase Data & Interactive State
const tinyvilleEvents = {
  "08:00": [
    { icon: "👩‍🍳", name: "Isabella Rodriguez", role: "Cafe Owner", tool: "⚡ Action", text: "Unlocking Hobbs Cafe front doors, firing up the espresso machine, and baking fresh croissants for opening." },
    { icon: "🎸", name: "Eddy Lin", role: "Music Student", tool: "🎵 Routine", text: "Practicing acoustic guitar in my room, working on a new chord progression before breakfast." },
    { icon: "📚", name: "Klaus Mueller", role: "Researcher", tool: "📖 Routine", text: "Settling into my desk at Smallville Library to begin today's social science literature review." },
    { icon: "🎓", name: "Maria Lopez", role: "College Student", tool: "📫 Mailbox", text: "On my way to morning classes, planning to stop by Hobbs Cafe later to help Isabella decorate for the party." },
    { icon: "🏪", name: "Tom Moreno", role: "Store Clerk", tool: "⚡ Action", text: "Unlocking Willows Market front doors and restocking front fruit displays for the morning rush." }
  ],
  "11:00": [
    { icon: "🏪", name: "Tom Moreno", role: "Store Clerk", tool: "💬 Dialogue", text: "Restocking shelves at Willows Market and discussing local election plans with John Lin." },
    { icon: "🎸", name: "Eddy Lin", role: "Music Student", tool: "☕ Social", text: "Walking down to Hobbs Cafe to grab an iced coffee and catch up with townsfolk." },
    { icon: "👩‍🍳", name: "Isabella Rodriguez", role: "Cafe Owner", tool: "📫 Mailbox", text: "Baking pastries and checking mailbox for incoming Valentine's Day party RSVPs." },
    { icon: "🎓", name: "Maria Lopez", role: "College Student", tool: "🎨 Routine", text: "Assisting Isabella at Hobbs Cafe with hanging colorful party streamers." }
  ],
  "14:00": [
    { icon: "👩‍🍳", name: "Isabella Rodriguez", role: "Cafe Owner", tool: "📫 Mailbox Bus", text: "Sending out final party reminders to Maria and townsfolk via Mailbox." },
    { icon: "🎓", name: "Maria Lopez", role: "College Student", tool: "📫 Mailbox Bus", text: "Checking Mailbox thread with Klaus Mueller: 'Hoping Klaus can come to the party tonight!'" },
    { icon: "📚", name: "Klaus Mueller", role: "Researcher", tool: "☕ Break", text: "Heading over to Hobbs Cafe for an afternoon coffee break and social chats." }
  ],
  "17:00": [
    { icon: "👩‍🍳", name: "Isabella Rodriguez", role: "Cafe Owner", tool: "🎉 Event", text: "Opening Hobbs Cafe doors wide and warmly welcoming Maria, Klaus, Tom, and guests as the Valentine's Party begins!" },
    { icon: "🎓", name: "Maria Lopez", role: "College Student", tool: "💬 Interaction", text: "Arriving at the party and warmly greeting Klaus: 'Hi Klaus! So glad you made it!'" },
    { icon: "📚", name: "Klaus Mueller", role: "Researcher", tool: "💬 Interaction", text: "Attending the Valentine's Day party at Hobbs Cafe and chatting with Maria and Isabella." },
    { icon: "🎸", name: "Eddy Lin", role: "Music Student", tool: "🎵 Performance", text: "Playing acoustic guitar at the corner of Hobbs Cafe to set a festive mood for the party." }
  ],
  "21:00": [
    { icon: "👩‍🍳", name: "Isabella Rodriguez", role: "Cafe Owner", tool: "✍️ Reflection", text: "Wiping down counters and recording evening reflection: 'A truly heartwarming Valentine's Day party at Hobbs Cafe!'" },
    { icon: "📚", name: "Klaus Mueller", role: "Researcher", tool: "✍️ Reflection", text: "Reviewing today's research notes and reflecting on the importance of social connections in Smallville." },
    { icon: "🏪", name: "Tom Moreno", role: "Store Clerk", tool: "✍️ Reflection", text: "Relaxing at home after a busy day at Willows Market, reflecting on community election discussions." }
  ]
};

let currentTimeSlot = "08:00";

// Navigation Tab Switcher
function switchNavTab(tabName) {
  const tinyvilleView = document.getElementById("view-tinyville");
  const consoleView = document.getElementById("view-console");
  const tabTinyvilleBtn = document.getElementById("tab-tinyville");
  const tabConsoleBtn = document.getElementById("tab-console");

  if (tabName === "tinyville") {
    tinyvilleView.style.display = "flex";
    consoleView.style.display = "none";
    tabTinyvilleBtn.classList.add("active");
    tabConsoleBtn.classList.remove("active");
  } else {
    tinyvilleView.style.display = "none";
    consoleView.style.display = "flex";
    tabTinyvilleBtn.classList.remove("active");
    tabConsoleBtn.classList.add("active");
  }
}

// Time Slot Selector
function selectTimeSlot(timeStr) {
  currentTimeSlot = timeStr;
  document.querySelectorAll(".time-btn").forEach(btn => {
    btn.classList.toggle("active", btn.textContent.includes(timeStr));
  });
  renderTinyvilleEvents(timeStr);
}

// Location Filter
function filterByLocation(locName) {
  document.querySelectorAll(".location-box").forEach(box => {
    box.classList.toggle("active", box.textContent.includes(locName));
  });
  // Render cards matching location context
  renderTinyvilleEvents(currentTimeSlot);
}

// Inspect Resident Subagent
function inspectAgent(agentId) {
  alert(`🤖 Subagent Memory Inspector:\nInspecting physical SQLite Database for resident [${agentId}] in .aura-workspace/state/subagents/${agentId}/state.db`);
}

// Render Tinyville Cards
function renderTinyvilleEvents(timeStr) {
  const container = document.getElementById("tinyville-feed");
  if (!container) return;
  
  container.innerHTML = "";
  const events = tinyvilleEvents[timeStr] || [];

  events.forEach(e => {
    const card = document.createElement("div");
    card.className = "timeline-card";
    card.innerHTML = `
      <div class="timeline-card-head">
        <div class="card-agent">
          <span class="agent-icon">${e.icon}</span>
          <div>
            <span class="agent-title">${e.name}</span>
            <span class="agent-subtitle">(${e.role})</span>
          </div>
        </div>
        <span class="time-tag">${timeStr}</span>
      </div>
      <div class="card-content-box">
        <span class="tool-chip">${e.tool}</span>
        <span>${e.text}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

// Initialize on Load
document.addEventListener("DOMContentLoaded", () => {
  renderTinyvilleEvents("08:00");
  switchNavTab("tinyville");
});
