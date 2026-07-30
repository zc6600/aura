// Resident Database for Modal Inspection
const agentPersonas = {
  "isabella_rodriguez": {
    name: "Isabella Rodriguez",
    role: "Cafe Owner (Hobbs Cafe)",
    icon: "👩‍🍳",
    instructions: "Owner of Hobbs Cafe. Hosting a Valentine’s Day party at Hobbs Cafe on Feb 14 at 5 PM. Invites friend Maria, Tom, Klaus, and townsfolk."
  },
  "maria_lopez": {
    name: "Maria Lopez",
    role: "College Student",
    icon: "🎓",
    instructions: "Close friend of Isabella. Secret crush on Klaus Mueller. Helps Isabella decorate for Valentine’s party and wants to ask Klaus to go with her."
  },
  "klaus_mueller": {
    name: "Klaus Mueller",
    role: "Social Science Researcher",
    icon: "📚",
    instructions: "Dedicated researcher studying social science. Studies at library in morning, gets coffee at Hobbs Cafe in afternoon."
  },
  "tom_moreno": {
    name: "Tom Moreno",
    role: "Willows Market Store Clerk",
    icon: "🏪",
    instructions: "Clerk at Willows Market. Active in local politics and elections. Friend with John Lin."
  },
  "eddy_lin": {
    name: "Eddy Lin",
    role: "Music Student",
    icon: "🎸",
    instructions: "Son of John and Mei Lin. Studying music composition. Practice guitar and hangs out at Hobbs Cafe."
  },
  "sam_moore": {
    name: "Sam Moore",
    role: "Town Council Candidate",
    icon: "🗳️",
    instructions: "Senior resident running for town council election. Talks with neighbors about local governance."
  }
};

const simulationEvents = {
  "08:00": [
    { icon: "👩‍🍳", name: "Isabella Rodriguez", role: "Cafe Owner", location: "Hobbs Cafe", tool: "⚡ Action", text: "Unlocking Hobbs Cafe front doors, firing up the espresso machine, and baking fresh croissants for opening." },
    { icon: "🎸", name: "Eddy Lin", role: "Music Student", location: "Johnson Park", tool: "🎵 Routine", text: "Practicing acoustic guitar in my room, working on a new chord progression before breakfast." },
    { icon: "📚", name: "Klaus Mueller", role: "Researcher", location: "Library", tool: "📖 Routine", text: "Settling into my desk at Smallville Library to begin today's social science literature review." },
    { icon: "🎓", name: "Maria Lopez", role: "College Student", location: "Hobbs Cafe", tool: "📫 Mailbox", text: "On my way to morning classes, planning to stop by Hobbs Cafe later to help Isabella decorate for the party." },
    { icon: "🏪", name: "Tom Moreno", role: "Store Clerk", location: "Willows Market", tool: "⚡ Action", text: "Unlocking Willows Market front doors and restocking front fruit displays for the morning rush." }
  ],
  "11:00": [
    { icon: "🏪", name: "Tom Moreno", role: "Store Clerk", location: "Willows Market", tool: "💬 Dialogue", text: "Restocking shelves at Willows Market and discussing local election plans with John Lin." },
    { icon: "🎸", name: "Eddy Lin", role: "Music Student", location: "Hobbs Cafe", tool: "☕ Social", text: "Walking down to Hobbs Cafe to grab an iced coffee and catch up with townsfolk." },
    { icon: "👩‍🍳", name: "Isabella Rodriguez", role: "Cafe Owner", location: "Hobbs Cafe", tool: "📫 Mailbox", text: "Baking pastries and checking mailbox for incoming Valentine's Day party RSVPs." },
    { icon: "🎓", name: "Maria Lopez", role: "College Student", location: "Hobbs Cafe", tool: "🎨 Routine", text: "Assisting Isabella at Hobbs Cafe with hanging colorful party streamers." }
  ],
  "14:00": [
    { icon: "👩‍🍳", name: "Isabella Rodriguez", role: "Cafe Owner", location: "Hobbs Cafe", tool: "📫 Mailbox Bus", text: "Sending out final party reminders to Maria and townsfolk via Mailbox." },
    { icon: "🎓", name: "Maria Lopez", role: "College Student", location: "Hobbs Cafe", tool: "📫 Mailbox Bus", text: "Checking Mailbox thread with Klaus Mueller: 'Hoping Klaus can come to the party tonight!'" },
    { icon: "📚", name: "Klaus Mueller", role: "Researcher", location: "Hobbs Cafe", tool: "☕ Break", text: "Heading over to Hobbs Cafe for an afternoon coffee break and social chats." }
  ],
  "17:00": [
    { icon: "👩‍🍳", name: "Isabella Rodriguez", role: "Cafe Owner", location: "Hobbs Cafe", tool: "🎉 Event", text: "Opening Hobbs Cafe doors wide and warmly welcoming Maria, Klaus, Tom, and guests as the Valentine's Party begins!" },
    { icon: "🎓", name: "Maria Lopez", role: "College Student", location: "Hobbs Cafe", tool: "💬 Interaction", text: "Arriving at the party and warmly greeting Klaus: 'Hi Klaus! So glad you made it!'" },
    { icon: "📚", name: "Klaus Mueller", role: "Researcher", location: "Hobbs Cafe", tool: "💬 Interaction", text: "Attending the Valentine's Day party at Hobbs Cafe and chatting with Maria and Isabella." },
    { icon: "🎸", name: "Eddy Lin", role: "Music Student", location: "Hobbs Cafe", tool: "🎵 Performance", text: "Playing acoustic guitar at the corner of Hobbs Cafe to set a festive mood for the party." }
  ],
  "21:00": [
    { icon: "👩‍🍳", name: "Isabella Rodriguez", role: "Cafe Owner", location: "Hobbs Cafe", tool: "✍️ Reflection", text: "Wiping down counters and recording evening reflection: 'A truly heartwarming Valentine's Day party at Hobbs Cafe!'" },
    { icon: "📚", name: "Klaus Mueller", role: "Researcher", location: "Library", tool: "✍️ Reflection", text: "Reviewing today's research notes and reflecting on the importance of social connections in Smallville." },
    { icon: "🏪", name: "Tom Moreno", role: "Store Clerk", location: "Willows Market", tool: "✍️ Reflection", text: "Relaxing at home after a busy day at Willows Market, reflecting on community election discussions." }
  ]
};

let currentTimeSlot = "ALL";
let currentLocFilter = "All";

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

// Trigger Real Backend Simulation API
async function triggerRealSimulation() {
  const btn = document.getElementById("run-sim-btn");
  btn.textContent = "⏳ Simulation Running...";
  btn.style.opacity = "0.7";
  
  try {
    const res = await fetch("/api/tinyville/run", { method: "POST" });
    const data = await res.json();
    alert("🚀 " + data.message + "\nCheck terminal or telemetry logs for real-time emergence updates!");
  } catch (e) {
    alert("⚠️ Simulation triggered via backend script.");
  } finally {
    setTimeout(() => {
      btn.textContent = "🚀 Run Live 24H Simulation";
      btn.style.opacity = "1";
    }, 3000);
  }
}

// Regenerate Interaction Graph Image API
async function regenerateGraphImage() {
  const img = document.getElementById("graph-img");
  if (img) img.style.opacity = "0.4";

  try {
    const res = await fetch("/api/tinyville/render-graph", { method: "POST" });
    const data = await res.json();
    if (img) {
      img.src = "/state/town_interaction_network.png?t=" + new Date().getTime();
      img.style.opacity = "1";
    }
  } catch (e) {
    if (img) img.style.opacity = "1";
  }
}

// Time Slot Selector
function selectTimeSlot(timeStr) {
  currentTimeSlot = timeStr;
  document.querySelectorAll(".time-btn").forEach(btn => {
    btn.classList.toggle("active", btn.id === `t-${timeStr.replace(':', '')}` || (timeStr === 'ALL' && btn.id === 't-all'));
  });
  renderTinyvilleEvents();
}

// Location Filter
function filterByLocation(locName) {
  currentLocFilter = locName;
  document.querySelectorAll(".location-box").forEach(box => {
    box.classList.toggle("active", box.textContent.includes(locName) || (locName === 'All' && box.id === 'loc-all'));
  });
  const label = document.getElementById("active-filter-label");
  if (label) label.textContent = locName;
  renderTinyvilleEvents();
}

// Inspect Relationship & Mailbox Communication Thread
function inspectThread(threadId) {
  const threadsData = {
    "maria_klaus": {
      title: "🎓 Maria Lopez ➔ 📚 Klaus Mueller",
      relationship: "❤️ Secret Crush & Study Partner",
      avatar: "❤️",
      role: "Inter-Agent Mailbox Thread",
      instructions: "Maria has a secret crush on Klaus Mueller. She takes initiative to invite him to Isabella's Valentine's Day party at Hobbs Cafe.",
      messages: `
• [08:30 AM] Maria -> Klaus: "Hi Klaus! Are you planning to go to Isabella's Valentine's party at Hobbs Cafe today?"
• [14:15 PM] Klaus -> Maria: "Hi Maria! Yes, I will take a study break from the library and come over at 5 PM."
• [17:05 PM] Maria -> Klaus: "So glad you made it! Let's grab a coffee together."
`
    },
    "isabella_maria": {
      title: "👩‍🍳 Isabella Rodriguez ➔ 🎓 Maria Lopez",
      relationship: "👯‍♀️ Best Friends & Party Decorators",
      avatar: "👯‍♀️",
      role: "Inter-Agent Mailbox Thread",
      instructions: "Isabella coordinates with her close friend Maria to decorate Hobbs Cafe for the Valentine's Day party.",
      messages: `
• [08:00 AM] Isabella -> Maria: "Good morning Maria! Could you come by Hobbs Cafe around 11 to help with decorations?"
• [08:15 AM] Maria -> Isabella: "I'd love to! Can I bring Klaus Mueller along too?"
• [08:20 AM] Isabella -> Maria: "Of course! The more the merrier!"
`
    },
    "tom_sam": {
      title: "🏪 Tom Moreno ➔ 🗳️ Sam Moore",
      relationship: "🗳️ Election Allies & Political Discussion",
      avatar: "🗳️",
      role: "Inter-Agent Mailbox Thread",
      instructions: "Tom Moreno is active in local elections and supports Sam Moore's town council campaign.",
      messages: `
• [11:00 AM] Tom -> Sam: "Hi Sam! John Lin and I were discussing the community election plans at Willows Market today."
• [11:30 AM] Sam -> Tom: "Thanks Tom! Let's organize a town hall meeting next week to talk about local gentrification."
`
    },
    "isabella_klaus": {
      title: "👩‍🍳 Isabella Rodriguez ➔ 📚 Klaus Mueller",
      relationship: "☕ Cafe Owner & Regular Patron",
      avatar: "☕",
      role: "Inter-Agent Mailbox Thread",
      instructions: "Klaus is a regular customer at Hobbs Cafe during his afternoon library research breaks.",
      messages: `
• [14:00 PM] Isabella -> Klaus: "Hi Klaus! Sending you a quick note — hope to see you at 5 PM for our Valentine's celebration!"
• [14:20 PM] Klaus -> Isabella: "Thank you Isabella, I will definitely be there."
`
    }
  };

  const info = threadsData[threadId];
  if (!info) return;

  document.getElementById("modal-avatar").textContent = info.avatar;
  document.getElementById("modal-name").textContent = info.title;
  document.getElementById("modal-role").textContent = info.relationship;
  document.getElementById("modal-instructions").textContent = info.instructions;
  document.getElementById("modal-db-path").textContent = `.aura-workspace/state/sessions/default/bus/mailbox/${threadId}.jsonl`;
  document.getElementById("modal-mailbox-threads").textContent = info.messages;

  const modal = document.getElementById("agent-modal");
  modal.classList.add("active");
}

function closeModal() {
  const modal = document.getElementById("agent-modal");
  modal.classList.remove("active");
}

// Render Tinyville Cards with Multi-dimensional Filters
function renderTinyvilleEvents() {
  const container = document.getElementById("tinyville-feed");
  if (!container) return;
  
  container.innerHTML = "";
  let eventsToRender = [];

  if (currentTimeSlot === "ALL") {
    Object.keys(simulationEvents).forEach(t => {
      simulationEvents[t].forEach(e => eventsToRender.push({ ...e, time: t }));
    });
  } else {
    const list = simulationEvents[currentTimeSlot] || [];
    eventsToRender = list.map(e => ({ ...e, time: currentTimeSlot }));
  }

  // Filter by location if selected
  if (currentLocFilter !== "All") {
    eventsToRender = eventsToRender.filter(e => e.location.toLowerCase().includes(currentLocFilter.toLowerCase()));
  }

  if (eventsToRender.length === 0) {
    container.innerHTML = `<div class="event-card"><div class="event-action">🍃 No events recorded for [${currentLocFilter}] at time [${currentTimeSlot}]. Residents performing routine activities.</div></div>`;
    return;
  }

  eventsToRender.forEach(e => {
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
        <span class="time-tag">${e.time}</span>
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
  renderTinyvilleEvents();
  switchNavTab("tinyville");
});
