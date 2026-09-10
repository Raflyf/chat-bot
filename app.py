import os
import subprocess
import sys
import urllib.request
import tarfile
import gradio as gr

def ensure_node():
    # Cek apakah node v22 sudah tersedia
    node_dir = os.path.abspath("node_bin")
    node_bin = os.path.join(node_dir, "bin")
    
    if not os.path.exists(node_dir):
        print("[HuggingFace] Mengunduh Node.js v22 runtime resmi...")
        url = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz"
        tar_path = "node.tar.xz"
        try:
            urllib.request.urlretrieve(url, tar_path)
            subprocess.run(["tar", "-xf", tar_path], check=True)
            for f in os.listdir("."):
                if f.startswith("node-v22") and os.path.isdir(f):
                    os.rename(f, node_dir)
                    break
            if os.path.exists(tar_path):
                os.remove(tar_path)
            print("[HuggingFace] Node.js v22 siap digunakan.")
        except Exception as e:
            print("[HuggingFace] Fallback sistem node:", e)

    if os.path.exists(node_bin):
        os.environ["PATH"] = node_bin + ":" + os.environ.get("PATH", "")

def start_bot():
    ensure_node()
    print("[HuggingFace] Menjalankan WhatsApp bot 24 jam nonstop...")
    # Jalankan proses WhatsApp Baileys di latar belakang
    subprocess.Popen(["npm", "run", "whatsapp:prod"])

# Jalankan bot saat aplikasi dimuat
start_bot()

# Web server Gradio minimal agar Hugging Face mendeteksi container aktif 24/7
with gr.Blocks(title="FreeAIBot WhatsApp 24/7") as demo:
    gr.Markdown("# FreeAIBot WhatsApp Asisten AI")
    gr.Markdown("Status: **Aktif 24 Jam Nonstop di Cloud**\n\nSilakan periksa tab **Logs** di menu Hugging Face Anda untuk melihat kode pairing WhatsApp.")

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)
