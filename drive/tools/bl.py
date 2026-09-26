"""Direct-socket client for the BlenderMCP add-on (port 9876).
Use for long-running jobs where the MCP bridge times out.
  python bl.py script.py            -> runs file in Blender, prints JSON reply
  python bl.py -c "print(1)"        -> runs inline code
"""
import json, socket, sys
def run(code, timeout=1800):
    s = socket.create_connection(("localhost", 9876), timeout=timeout)
    s.sendall(json.dumps({"type": "execute_code", "params": {"code": code}}).encode())
    buf = b""
    while True:
        chunk = s.recv(65536)
        if not chunk: break
        buf += chunk
        try: return json.loads(buf.decode())
        except json.JSONDecodeError: continue
    return json.loads(buf.decode())
if __name__ == "__main__":
    code = sys.argv[2] if sys.argv[1] == "-c" else open(sys.argv[1], encoding="utf-8").read()
    print(json.dumps(run(code), indent=1)[:20000])
