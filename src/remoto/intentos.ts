import type { BaseD1 } from '../persistencia/d1.js';

/**
 * Límite de logins fallidos en /authorize. Todos los logins le llegan a Supabase desde las IPs de
 * Cloudflare, así que su propio límite por IP no distingue alumnos: este frena a quien prueba
 * contraseñas, por correo (protege cada cuenta) y por IP (protege el servicio). Solo cuentan los fallos.
 */
export const VENTANA_MS = 15 * 60 * 1000;
export const MAX_FALLOS_POR_CORREO = 5;
export const MAX_FALLOS_POR_IP = 20;

const claveCorreo = (email: string) => `correo:${email.trim().toLowerCase()}`;
const claveIp = (ip: string) => `ip:${ip}`;

export class IntentosLogin {
  constructor(
    private readonly db: BaseD1,
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  /** ¿Puede intentar? Se pregunta antes de llamar a Supabase */
  async permitido(email: string, ip: string): Promise<boolean> {
    const desde = new Date(this.ahora().getTime() - VENTANA_MS).toISOString();
    const contar = (clave: string) =>
      this.db
        .prepare('select count(*) as n from intentos_login where clave = ? and en >= ?')
        .bind(clave, desde)
        .first<{ n: number }>();
    const [correo, porIp] = await Promise.all([contar(claveCorreo(email)), contar(claveIp(ip))]);
    return Number(correo?.n ?? 0) < MAX_FALLOS_POR_CORREO && Number(porIp?.n ?? 0) < MAX_FALLOS_POR_IP;
  }

  async registrarFallo(email: string, ip: string): Promise<void> {
    const ahora = this.ahora();
    const en = ahora.toISOString();
    // Limpieza de paso: nada de más de un día sirve para la ventana
    const viejo = new Date(ahora.getTime() - 24 * 60 * 60 * 1000).toISOString();
    await this.db.batch([
      this.db.prepare('insert into intentos_login (clave, en) values (?, ?)').bind(claveCorreo(email), en),
      this.db.prepare('insert into intentos_login (clave, en) values (?, ?)').bind(claveIp(ip), en),
      this.db.prepare('delete from intentos_login where en < ?').bind(viejo),
    ]);
  }
}
