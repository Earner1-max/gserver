const Database = require('better-sqlite3');
const { 
    DATABASE_FILE, 
    DEFAULT_REFER_AMOUNT, 
    DEFAULT_MINE_AMOUNT, 
    DEFAULT_MIN_WITHDRAWAL, 
    DEFAULT_MINE_COOLDOWN 
} = require('./config');

function get_conn() {
    const db = new Database(DATABASE_FILE);
    // better-sqlite3 returns rows as objects by default, similar to sqlite3.Row
    return db;
}

function init_db() {
    const conn = get_conn();
    // better-sqlite3 .exec() runs multiple statements, similar to executescript
    conn.exec(`
        CREATE TABLE IF NOT EXISTS users (
            user_id            INTEGER PRIMARY KEY,
            username           TEXT    DEFAULT '',
            full_name          TEXT    DEFAULT '',
            balance            REAL    DEFAULT 0,
            referred_by        INTEGER DEFAULT NULL,
            referral_count     INTEGER DEFAULT 0,
            joined_at          INTEGER DEFAULT (strftime('%s','now')),
            verified           INTEGER DEFAULT 0,
            tge_joined         INTEGER DEFAULT 0,
            presale_joined     INTEGER DEFAULT 0,
            last_mine          INTEGER DEFAULT 0,
            withdrawal_percent INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS tge_requests (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL,
            oxapay_track TEXT,
            status       TEXT    DEFAULT 'pending',
            created_at   INTEGER DEFAULT (strftime('%s','now')),
            reviewed_at  INTEGER DEFAULT NULL,
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS presale_requests (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL,
            tx_hash      TEXT,
            oxapay_track TEXT,
            status       TEXT    DEFAULT 'pending',
            created_at   INTEGER DEFAULT (strftime('%s','now')),
            reviewed_at  INTEGER DEFAULT NULL,
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS withdrawals (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            type        TEXT    NOT NULL,
            amount_gtc  REAL    NOT NULL,
            amount_usdt REAL    NOT NULL,
            bnb_address TEXT    NOT NULL,
            status      TEXT    DEFAULT 'pending',
            created_at  INTEGER DEFAULT (strftime('%s','now')),
            reviewed_at INTEGER DEFAULT NULL,
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS comment_verifications (
            user_id           INTEGER PRIMARY KEY,
            screenshot_file_id TEXT,
            submitted_at      INTEGER DEFAULT (strftime('%s','now'))
        );
    `);

    const defaults = [
        ["refer_amount",     String(DEFAULT_REFER_AMOUNT)],
        ["mine_amount",      String(DEFAULT_MINE_AMOUNT)],
        ["mine_cooldown",    String(DEFAULT_MINE_COOLDOWN)],
        ["min_withdrawal",   String(DEFAULT_MIN_WITHDRAWAL)],
        ["comment_post_url", "https://x.com/i/status/2053857757900541991"],
    ];

    const stmt = conn.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)");
    for (const [key, val] of defaults) {
        stmt.run(key, val);
    }

    // better-sqlite3 commits automatically for non-transactional run/exec
    conn.close();
}

// ── Settings ──────────────────────────────────────────────────────────────────

function get_setting(key) {
    const conn = get_conn();
    const row  = conn.prepare("SELECT value FROM settings WHERE key=?").get(key);
    conn.close();
    return row ? row.value : null;
}

function set_setting(key, value) {
    const conn = get_conn();
    conn.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run(key, value);
    conn.close();
}

// ── Users ─────────────────────────────────────────────────────────────────────

function get_user(user_id) {
    const conn = get_conn();
    const row  = conn.prepare("SELECT * FROM users WHERE user_id=?").get(user_id);
    conn.close();
    return row ? row : null;
}

function create_user(user_id, username, full_name, referred_by = null) {
    const conn = get_conn();
    conn.prepare(
        "INSERT OR IGNORE INTO users (user_id,username,full_name,referred_by) VALUES (?,?,?,?)"
    ).run(user_id, username, full_name, referred_by);
    conn.close();
}

function update_user(user_id, kwargs) {
    const conn = get_conn();
    const keys = Object.keys(kwargs);
    const sets = keys.map(k => `${k}=?`).join(", ");
    const vals = [...Object.values(kwargs), user_id];
    conn.prepare(`UPDATE users SET ${sets} WHERE user_id=?`).run(...vals);
    conn.close();
}

function add_balance(user_id, amount) {
    const conn = get_conn();
    conn.prepare("UPDATE users SET balance=balance+? WHERE user_id=?").run(amount, user_id);
    conn.close();
}

function deduct_balance(user_id, amount) {
    const conn = get_conn();
    conn.prepare("UPDATE users SET balance=MAX(0,balance-?) WHERE user_id=?").run(amount, user_id);
    conn.close();
}

function get_all_users() {
    const conn = get_conn();
    const rows = conn.prepare("SELECT user_id FROM users").all();
    conn.close();
    return rows.map(r => r.user_id);
}

// ── TGE requests ──────────────────────────────────────────────────────────────

function create_tge_request(user_id, oxapay_track = null) {
    const conn = get_conn();
    conn.prepare("INSERT INTO tge_requests (user_id, oxapay_track) VALUES (?,?)").run(user_id, oxapay_track);
    conn.close();
}

function get_tge_request_by_id(req_id) {
    const conn = get_conn();
    const row = conn.prepare("SELECT * FROM tge_requests WHERE id=?").get(req_id);
    conn.close();
    return row ? row : null;
}

function get_presale_request_by_id(req_id) {
    const conn = get_conn();
    const row = conn.prepare("SELECT * FROM presale_requests WHERE id=?").get(req_id);
    conn.close();
    return row ? row : null;
}

function get_withdrawal_by_id(req_id) {
    const conn = get_conn();
    const row = conn.prepare("SELECT * FROM withdrawals WHERE id=?").get(req_id);
    conn.close();
    return row ? row : null;
}

function get_pending_tge_requests() {
    const conn = get_conn();
    const rows = conn.prepare(
        "SELECT t.*,u.username,u.full_name,u.balance FROM tge_requests t " +
        "JOIN users u ON t.user_id=u.user_id WHERE t.status='pending' ORDER BY t.created_at"
    ).all();
    conn.close();
    return rows;
}

function update_tge_request(req_id, status) {
    const conn = get_conn();
    conn.prepare("UPDATE tge_requests SET status=?,reviewed_at=? WHERE id=?").run(
        status, Math.floor(Date.now() / 1000), req_id
    );
    conn.close();
}

function get_user_tge_request(user_id) {
    const conn = get_conn();
    const row = conn.prepare(
        "SELECT * FROM tge_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 1"
    ).get(user_id);
    conn.close();
    return row ? row : null;
}

// ── Presale requests ──────────────────────────────────────────────────────────

function create_presale_request(user_id, tx_hash = null, oxapay_track = null) {
    const conn = get_conn();
    conn.prepare(
        "INSERT INTO presale_requests (user_id,tx_hash,oxapay_track) VALUES (?,?,?)"
    ).run(user_id, tx_hash, oxapay_track);
    conn.close();
}

function get_pending_presale_requests() {
    const conn = get_conn();
    const rows = conn.prepare(
        "SELECT p.*,u.username,u.full_name FROM presale_requests p " +
        "JOIN users u ON p.user_id=u.user_id WHERE p.status='pending' ORDER BY p.created_at"
    ).all();
    conn.close();
    return rows;
}

function update_presale_request(req_id, status) {
    const conn = get_conn();
    conn.prepare("UPDATE presale_requests SET status=?,reviewed_at=? WHERE id=?").run(
        status, Math.floor(Date.now() / 1000), req_id
    );
    conn.close();
}

function get_user_presale_request(user_id) {
    const conn = get_conn();
    const row = conn.prepare(
        "SELECT * FROM presale_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 1"
    ).get(user_id);
    conn.close();
    return row ? row : null;
}

// ── Withdrawals ───────────────────────────────────────────────────────────────

function create_withdrawal(user_id, wtype, amount_gtc, amount_usdt, bnb_address) {
    const conn = get_conn();
    conn.prepare(
        "INSERT INTO withdrawals (user_id,type,amount_gtc,amount_usdt,bnb_address) VALUES (?,?,?,?,?)"
    ).run(user_id, wtype, amount_gtc, amount_usdt, bnb_address);
    conn.close();
}

function get_pending_withdrawals() {
    const conn = get_conn();
    const rows = conn.prepare(
        "SELECT w.*,u.username,u.full_name FROM withdrawals w " +
        "JOIN users u ON w.user_id=u.user_id WHERE w.status='pending' ORDER BY w.created_at"
    ).all();
    conn.close();
    return rows;
}

function update_withdrawal(req_id, status) {
    const conn = get_conn();
    conn.prepare("UPDATE withdrawals SET status=?,reviewed_at=? WHERE id=?").run(
        status, Math.floor(Date.now() / 1000), req_id
    );
    conn.close();
}

// ── Distribution stats ────────────────────────────────────────────────────────

function get_distribution_stats() {
    const conn = get_conn();
    const total_balance    = conn.prepare("SELECT COALESCE(SUM(balance),0) AS s FROM users").get().s;
    const total_users      = conn.prepare("SELECT COUNT(*) AS c FROM users").get().c;
    const verified         = conn.prepare("SELECT COUNT(*) AS c FROM users WHERE verified=1").get().c;
    const tge_users        = conn.prepare("SELECT COUNT(*) AS c FROM users WHERE tge_joined=1").get().c;
    const presale_users    = conn.prepare("SELECT COUNT(*) AS c FROM users WHERE presale_joined=1").get().c;
    const presale_rewarded = conn.prepare("SELECT COUNT(*) AS c FROM presale_requests WHERE status='approved'").get().c;
    const mine_today       = conn.prepare(
        "SELECT COUNT(*) AS c FROM users WHERE last_mine>=?"
    ).get(Math.floor(Date.now() / 1000) - 86400).c;
    const pending_wd       = conn.prepare("SELECT COUNT(*) AS c FROM withdrawals WHERE status='pending'").get().c;
    conn.close();
    
    return {
        total_balance: total_balance,
        total_users: total_users,
        verified: verified,
        tge_users: tge_users,
        presale_users: presale_users,
        presale_rewarded: presale_rewarded,
        mine_today: mine_today,
        pending_wd: pending_wd
    };
}

// ── Screenshots ───────────────────────────────────────────────────────────────

function save_screenshot(user_id, file_id) {
    const conn = get_conn();
    conn.prepare(
        "INSERT OR REPLACE INTO comment_verifications (user_id,screenshot_file_id,submitted_at) VALUES (?,?,?)"
    ).run(user_id, file_id, Math.floor(Date.now() / 1000));
    conn.close();
}

module.exports = {
    init_db,
    get_setting,
    set_setting,
    get_user,
    create_user,
    update_user,
    add_balance,
    deduct_balance,
    get_all_users,
    create_tge_request,
    get_tge_request_by_id,
    get_presale_request_by_id,
    get_withdrawal_by_id,
    get_pending_tge_requests,
    update_tge_request,
    get_user_tge_request,
    create_presale_request,
    get_pending_presale_requests,
    update_presale_request,
    get_user_presale_request,
    create_withdrawal,
    get_pending_withdrawals,
    update_withdrawal,
    get_distribution_stats,
    save_screenshot
};
