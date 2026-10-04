import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ROLE_RANK, type AuditEntry, type Role, type SessionUser, type UserConfig } from '../../../shared/types.ts';
import type { Database } from '../core/Database.ts';
import { AppError, forbidden } from '../core/errors.ts';
import { createLogger } from '../core/logger.ts';

const log = createLogger('auth');

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 32).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(expected, actual);
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');

export function hasRole(user: SessionUser | undefined, role: Role): boolean {
  return ROLE_RANK[user?.role ?? 'viewer'] >= ROLE_RANK[role] && (user !== undefined || role === 'viewer');
}

/** Users come from project.yaml; sessions are stateless HMAC-signed tokens. */
export class AuthService {
  private readonly db: Database;
  private users = new Map<string, UserConfig>();
  private secret: string;
  private ttlMs = 12 * 3_600_000;
  anonymousRole: Role | undefined = 'viewer';

  constructor(db: Database) {
    this.db = db;
    this.secret = process.env.NEXUS_SECRET ?? db.getKv<string>('auth:secret') ?? '';
    if (!this.secret) {
      this.secret = randomBytes(32).toString('hex');
      db.setKv('auth:secret', this.secret);
    }
  }

  load(users: UserConfig[] = [], opts: { tokenSecret?: string; tokenTtlHours?: number; anonymousRole?: Role | null } = {}): void {
    this.users = new Map(users.map((u) => [u.username.toLowerCase(), u]));
    if (opts.tokenSecret) this.secret = opts.tokenSecret;
    if (opts.tokenTtlHours) this.ttlMs = opts.tokenTtlHours * 3_600_000;
    this.anonymousRole = opts.anonymousRole === null ? undefined : opts.anonymousRole ?? 'viewer';
    const plain = users.filter((u) => u.password && !u.passwordHash).map((u) => u.username);
    if (plain.length) log.warn(`users with plain-text passwords (use passwordHash in production): ${plain.join(', ')}`);
  }

  login(username: string, password: string): { token: string; user: SessionUser } {
    const u = this.users.get(String(username).toLowerCase());
    const ok = u && (u.passwordHash ? verifyPassword(password, u.passwordHash) : u.password !== undefined && u.password === password);
    if (!u || !ok) {
      this.audit(username || '?', 'login.failed');
      throw new AppError('Invalid username or password', 401);
    }
    const user: SessionUser = { username: u.username, fullName: u.fullName, role: u.role };
    this.audit(u.username, 'login');
    return { token: this.sign(user), user };
  }

  private sign(user: SessionUser): string {
    const payload = b64(JSON.stringify({ ...user, exp: Date.now() + this.ttlMs }));
    const sig = createHmac('sha256', this.secret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  /** Returns the session user for a token, or undefined when missing/invalid/expired. */
  verify(token: string | undefined | null): SessionUser | undefined {
    if (!token) return undefined;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return undefined;
    const expected = createHmac('sha256', this.secret).update(payload).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionUser & { exp: number };
      if (data.exp < Date.now()) return undefined;
      const current = this.users.get(data.username.toLowerCase());
      if (!current) return undefined; // user removed since login
      return { username: current.username, fullName: current.fullName, role: current.role };
    } catch {
      return undefined;
    }
  }

  /** Effective user: logged-in user, or anonymous with the configured role. */
  effective(user: SessionUser | undefined): SessionUser | undefined {
    if (user) return user;
    return this.anonymousRole ? { username: 'anonymous', role: this.anonymousRole } : undefined;
  }

  require(user: SessionUser | undefined, role: Role): SessionUser {
    const eff = this.effective(user);
    if (!eff) throw new AppError('Login required', 401);
    if (ROLE_RANK[eff.role] < ROLE_RANK[role]) throw forbidden(`Requires role "${role}"`);
    return eff;
  }

  audit(user: string, action: string, target?: string, details?: unknown): void {
    try {
      this.db.run(
        'INSERT INTO audit (ts, user, action, target, details) VALUES (?,?,?,?,?)',
        Date.now(), user, action, target ?? null, details === undefined ? null : typeof details === 'string' ? details : JSON.stringify(details),
      );
    } catch (err) {
      log.error('audit write failed:', err);
    }
  }

  auditLog(opts: { from: number; to: number; search?: string; limit?: number }): AuditEntry[] {
    const like = `%${opts.search ?? ''}%`;
    return this.db.query<AuditEntry>(
      `SELECT * FROM audit WHERE ts BETWEEN ? AND ? AND (user LIKE ? OR action LIKE ? OR IFNULL(target,'') LIKE ?) ORDER BY ts DESC LIMIT ?`,
      opts.from, opts.to, like, like, like, Math.min(opts.limit ?? 500, 5000),
    );
  }
}
