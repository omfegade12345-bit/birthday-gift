"""Secret Birthday Gift - Flask backend.

* "/"                       -> first page: sender / receiver names + birthday form
* POST /api/create          -> collects the data (SQLite + gifts.csv) and returns a share link
* "/g/<id>"                 -> the gift experience (countdown to 12:00 AM of the birthday)
* POST /api/g/<id>/verify   -> checks the passcode, returns the letter + photos
* python app.py export      -> print every collected record as CSV
* "/admin"                  -> owner-only table of ALL gifts (password protected)

Run:  pip install flask  &&  python app.py   ->  http://127.0.0.1:5000
"""
import csv
import io
import os
import re
import secrets
import sqlite3
import sys
from datetime import date, datetime
from functools import wraps

from flask import Flask, Response, abort, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
UPLOAD_DIR = os.path.join(BASE, "uploads")
DB_PATH = os.path.join(DATA_DIR, "gifts.db")
CSV_PATH = os.path.join(DATA_DIR, "gifts.csv")
ALLOWED_EXT = {"png", "jpg", "jpeg", "gif", "webp"}
CSV_FIELDS = ["id", "created_at", "sender_name", "receiver_name", "birthday", "passcode", "letter"]

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20 MB per request

DEFAULT_LETTER = (
    "Happy birthday to my favourite person! ♥\n\n"
    "I hope this year brings you everything you've been wishing for and so much more. "
    "Thank you for making my bad days easier, my good days happier, and my life a little "
    "more beautiful just by being in it.\n\n"
    "I'm so lucky to have you, and I can't wait to make a million more memories with you."
)


# --------------------------------------------------------------------------- db
def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    with db() as con:
        con.execute(
            """CREATE TABLE IF NOT EXISTS gifts (
                   id TEXT PRIMARY KEY,
                   created_at TEXT NOT NULL,
                   sender_name TEXT NOT NULL,
                   receiver_name TEXT NOT NULL,
                   birthday TEXT NOT NULL,
                   passcode TEXT NOT NULL,
                   letter TEXT NOT NULL
               )"""
        )
        con.execute(
            """CREATE TABLE IF NOT EXISTS photos (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   gift_id TEXT NOT NULL,
                   filename TEXT NOT NULL,
                   caption TEXT NOT NULL DEFAULT ''
               )"""
        )


def append_csv(row):
    new = not os.path.exists(CSV_PATH)
    with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        if new:
            w.writeheader()
        w.writerow({k: row[k] for k in CSV_FIELDS})


def get_gift(gift_id):
    with db() as con:
        return con.execute("SELECT * FROM gifts WHERE id = ?", (gift_id,)).fetchone()


# ------------------------------------------------------------------------ pages
@app.route("/")
def index():
    return render_template("index.html", today=date.today().isoformat())


@app.route("/g/<gift_id>")
def gift_page(gift_id):
    g = get_gift(gift_id)
    if not g:
        abort(404)
    info = {
        "id": g["id"],
        "sender": g["sender_name"],
        "receiver": g["receiver_name"],
        "birthday": g["birthday"],  # YYYY-MM-DD
    }
    return render_template("gift.html", info=info)


@app.route("/uploads/<path:name>")
def uploads(name):
    return send_from_directory(UPLOAD_DIR, name)


# -------------------------------------------------------------------------- api
def clean(text, limit):
    return re.sub(r"\s+", " ", (text or "")).strip()[:limit]


@app.post("/api/create")
def create():
    sender = clean(request.form.get("sender_name"), 40)
    receiver = clean(request.form.get("receiver_name"), 40)
    birthday = (request.form.get("birthday") or "").strip()
    passcode = (request.form.get("passcode") or "").strip()
    letter = (request.form.get("letter") or "").strip()[:1200] or DEFAULT_LETTER

    errors = {}
    if not sender:
        errors["sender_name"] = "Please enter your name."
    if not receiver:
        errors["receiver_name"] = "Please enter the receiver's name."
    try:
        datetime.strptime(birthday, "%Y-%m-%d")
    except ValueError:
        errors["birthday"] = "Please pick the birthday date."
    if not re.fullmatch(r"\d{4}", passcode):
        errors["passcode"] = "Passcode must be exactly 4 digits."
    if errors:
        return jsonify(ok=False, errors=errors), 400

    gift_id = secrets.token_urlsafe(6)
    created = datetime.now().isoformat(timespec="seconds")

    saved = []
    for i in range(3):
        f = request.files.get(f"photo{i}")
        if not f or not f.filename:
            continue
        ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
        if ext not in ALLOWED_EXT:
            return jsonify(ok=False, errors={"photos": "Photos must be png, jpg, gif or webp."}), 400
        name = f"{gift_id}_{i}_{secure_filename(f.filename)}"
        f.save(os.path.join(UPLOAD_DIR, name))
        saved.append((name, clean(request.form.get(f"caption{i}"), 40)))

    with db() as con:
        con.execute(
            "INSERT INTO gifts VALUES (?,?,?,?,?,?,?)",
            (gift_id, created, sender, receiver, birthday, passcode, letter),
        )
        con.executemany(
            "INSERT INTO photos (gift_id, filename, caption) VALUES (?,?,?)",
            [(gift_id, n, c) for n, c in saved],
        )
    append_csv(dict(id=gift_id, created_at=created, sender_name=sender, receiver_name=receiver,
                    birthday=birthday, passcode=passcode, letter=letter))

    return jsonify(ok=True, id=gift_id, url=request.host_url.rstrip("/") + f"/g/{gift_id}")


@app.post("/api/g/<gift_id>/verify")
def verify(gift_id):
    g = get_gift(gift_id)
    if not g:
        abort(404)
    code = str((request.get_json(silent=True) or {}).get("code", ""))
    if not secrets.compare_digest(code, g["passcode"]):
        return jsonify(ok=False), 401
    with db() as con:
        rows = con.execute("SELECT filename, caption FROM photos WHERE gift_id = ? ORDER BY id", (gift_id,)).fetchall()
    photos = [{"src": f"/uploads/{r['filename']}", "caption": r["caption"]} for r in rows]
    return jsonify(ok=True, letter=g["letter"], photos=photos)



# ------------------------------------------------------------------------ admin
# Password: set the ADMIN_PASSWORD environment variable. If it is not set, a random
# one is generated on every start and printed in the console.
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or secrets.token_urlsafe(9)
PASSWORD_WAS_GENERATED = "ADMIN_PASSWORD" not in os.environ


def admin_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        auth = request.authorization
        ok = (
            auth is not None
            and secrets.compare_digest(auth.username or "", ADMIN_USER)
            and secrets.compare_digest(auth.password or "", ADMIN_PASSWORD)
        )
        if not ok:
            return Response("Admin login required", 401, {"WWW-Authenticate": 'Basic realm="Gift admin"'})
        return fn(*a, **kw)
    return wrapper


def all_gifts(q=""):
    with db() as con:
        rows = con.execute(
            """SELECT g.*, (SELECT COUNT(*) FROM photos p WHERE p.gift_id = g.id) AS photo_count
               FROM gifts g ORDER BY created_at DESC"""
        ).fetchall()
    q = q.strip().lower()
    if q:
        rows = [r for r in rows if q in (r["sender_name"] + " " + r["receiver_name"] + " " + r["birthday"]).lower()]
    return rows


def rewrite_csv():
    with db() as con:
        rows = con.execute("SELECT * FROM gifts ORDER BY created_at").fetchall()
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(CSV_FIELDS)
        for r in rows:
            w.writerow([r[k] for k in CSV_FIELDS])


def safe_cell(v):
    """Stop spreadsheet formula injection (=, +, -, @) in downloaded CSV files."""
    v = str(v)
    return "'" + v if v[:1] in ("=", "+", "-", "@") else v


@app.get("/admin")
@admin_required
def admin():
    q = request.args.get("q", "")
    rows = all_gifts(q)
    return render_template("admin.html", rows=rows, q=q, total=len(all_gifts()), today=date.today().isoformat())


@app.get("/admin/export.csv")
@admin_required
def admin_export():
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(CSV_FIELDS)
    for r in all_gifts():
        w.writerow([safe_cell(r[k]) for k in CSV_FIELDS])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=gifts.csv"})


@app.post("/admin/delete/<gift_id>")
@admin_required
def admin_delete(gift_id):
    # custom header: a browser cannot add it on a cross-site form post (CSRF protection)
    if request.headers.get("X-Requested-With") != "fetch":
        abort(400)
    with db() as con:
        files = [r["filename"] for r in con.execute("SELECT filename FROM photos WHERE gift_id = ?", (gift_id,))]
        con.execute("DELETE FROM photos WHERE gift_id = ?", (gift_id,))
        con.execute("DELETE FROM gifts WHERE id = ?", (gift_id,))
    for name in files:
        try:
            os.remove(os.path.join(UPLOAD_DIR, name))
        except OSError:
            pass
    rewrite_csv()
    return jsonify(ok=True)

# -------------------------------------------------------------------------- cli
def export_csv():
    init_db()
    with db() as con:
        rows = con.execute("SELECT * FROM gifts ORDER BY created_at").fetchall()
    w = csv.writer(sys.stdout)
    w.writerow(CSV_FIELDS)
    for r in rows:
        w.writerow([r[k] for k in CSV_FIELDS])


init_db()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "export":
        export_csv()
    else:
        print(f"\n  Admin page: http://127.0.0.1:{os.environ.get('PORT', 5000)}/admin")
        print(f"  Username: {ADMIN_USER}   Password: {ADMIN_PASSWORD}" +
              ("   (random - set ADMIN_PASSWORD to choose your own)" if PASSWORD_WAS_GENERATED else "") + "\n")
        app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
