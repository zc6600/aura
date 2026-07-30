# /// script
# dependencies = [
#   "matplotlib",
#   "networkx",
# ]
# ///

"""
Pure Ground-Truth Stanford Smallville Interaction Graph Visualizer
NO FAKE SEEDS. NO MOCK DATA.
Strictly parses state/personas/*.json files and state/*.log execution traces.
"""
import os
import glob
import json
import re

def get_all_real_personas():
    persona_dir = os.path.join(os.getcwd(), "state", "personas")
    personas = {}
    if os.path.exists(persona_dir):
        for f in sorted(glob.glob(os.path.join(persona_dir, "*.json"))):
            try:
                with open(f, "r", encoding="utf-8") as file:
                    data = json.load(file)
                    pid = data.get("id") or os.path.basename(f).replace(".json", "")
                    pname = data.get("name") or pid.replace("_", " ").title()
                    instructions = data.get("instructions", "")
                    personas[pid] = {
                        "name": pname,
                        "short_name": pname.split(" ")[0],
                        "instructions": instructions
                    }
            except Exception:
                pass
    return personas

def parse_ground_truth_interactions(personas):
    agents = [p["short_name"] for p in personas.values()]
    # Deduplicate agents short names
    unique_agents = []
    for a in agents:
        if a not in unique_agents:
            unique_agents.append(a)
            
    mentions = {a: {b: 0 for b in unique_agents} for a in unique_agents}
    
    # 1. Parse initial relationships defined in persona instructions
    for pid, pdata in personas.items():
        speaker = pdata["short_name"]
        instr = pdata["instructions"]
        for target in unique_agents:
            if speaker != target and target.lower() in instr.lower():
                mentions[speaker][target] += 2  # Persona baseline connection
                
    # 2. Parse actual runtime log files
    state_dir = os.path.join(os.getcwd(), "state")
    log_files = [
        "rich_emergence_simulation.log",
        "pretty_emergence_simulation.log",
        "host_pure_emergence_simulation.log",
        "real_subagent_simulation.log"
    ]
    
    for lfile in log_files:
        full_path = os.path.join(state_dir, lfile)
        if not os.path.exists(full_path):
            continue
            
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        for line in content.split("\n"):
            speaker = None
            for a in unique_agents:
                if f"[{a}" in line or f"{a}:" in line or f"Subagent: {a.lower()}" in line:
                    speaker = a
                    break
            
            if speaker:
                for target in unique_agents:
                    if speaker != target and target.lower() in line.lower():
                        mentions[speaker][target] += 1
                        
    return unique_agents, mentions

def generate_visualizations(agents, mentions):
    import matplotlib.pyplot as plt
    import networkx as nx

    plt.style.use('default')
    fig, ax = plt.subplots(figsize=(11, 9), facecolor='#ffffff')
    ax.set_facecolor('#ffffff')
    
    G = nx.DiGraph()
    for a in agents:
        G.add_node(a)
        
    for a in agents:
        for b in agents:
            w = mentions[a][b]
            if w > 0:
                G.add_edge(a, b, weight=w)
                
    connected_nodes = [n for n in G.nodes() if G.degree(n) > 0]
    subG = G.subgraph(connected_nodes) if len(connected_nodes) > 0 else G
    
    pos = nx.spring_layout(subG, k=1.8, seed=42)
    
    node_colors = ['#2563eb' if n in ['Isabella', 'Maria', 'Klaus', 'Tom', 'Sam', 'Eddy'] else '#475569' for n in subG.nodes()]
    node_sizes = [1800 if n in ['Isabella', 'Maria', 'Klaus', 'Tom', 'Sam'] else 1200 for n in subG.nodes()]
    
    nx.draw_networkx_nodes(subG, pos, node_size=node_sizes, node_color=node_colors, alpha=0.9, ax=ax)
    nx.draw_networkx_labels(subG, pos, font_size=10, font_weight='bold', font_color='#ffffff', ax=ax)
    
    for u, v, d in subG.edges(data=True):
        w = d['weight']
        edge_color = '#dc2626' if (u=='Maria' and v=='Klaus') or (u=='Klaus' and v=='Maria') else '#2563eb'
        ax.annotate("",
                    xy=pos[v], xycoords='data',
                    xytext=pos[u], textcoords='data',
                    arrowprops=dict(arrowstyle="->", color=edge_color,
                                    shrinkA=22, shrinkB=22,
                                    patchA=None, patchB=None,
                                    connectionstyle="arc3,rad=0.15",
                                    linewidth=1.0 + min(w, 10) * 0.4, alpha=0.7))

    plt.title("Agent Interaction & Mention Network", fontsize=14, fontweight='bold', color='#0f172a', pad=20)
    plt.axis('off')
    plt.tight_layout()
    
    output_path = os.path.join(os.getcwd(), "state", "town_interaction_network.png")
    plt.savefig(output_path, dpi=200, bbox_inches='tight', facecolor='#ffffff')
    plt.close()
    print(f"✅ Generated Academic White Theme Graph: {output_path}")

def main():
    print(" Parsing ground-truth persona files & execution logs (NO FAKE SEEDS)...")
    personas = get_all_real_personas()
    agents, mentions = parse_ground_truth_interactions(personas)
    generate_visualizations(agents, mentions)

if __name__ == "__main__":
    main()
