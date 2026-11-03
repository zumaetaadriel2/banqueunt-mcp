/**
 * Lo poco que el Worker necesita de Supabase: iniciar sesión con correo y contraseña, renovar la sesión
 * y preguntar a `mis_cursos()` qué cursos puede ver la cuenta. Solo usa la URL y la anon key (públicas);
 * la service role key nunca llega aquí. La regla de acceso vive en Supabase, no se reimplementa.
 */

export interface ConfigSupabase {
  url: string;
  anonKey: string;
  /** Para los tests; en el Worker, el fetch global */
  fetch?: typeof fetch;
}

export interface SesionSupabase {
  /** uuid de auth.users: el usuario del progreso y del tope diario */
  usuario: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

/** Correo o contraseña incorrectos, cuenta sin confirmar o sesión que ya no se puede renovar */
export class CredencialesInvalidas extends Error {}

const RespuestaToken = (datos: unknown): SesionSupabase | undefined => {
  const d = datos as {
    access_token?: unknown;
    refresh_token?: unknown;
    user?: { id?: unknown; email?: unknown };
  };
  if (
    typeof d?.access_token !== 'string' ||
    typeof d.refresh_token !== 'string' ||
    typeof d.user?.id !== 'string' ||
    !d.user.id
  ) {
    return undefined;
  }
  return {
    usuario: d.user.id,
    email: typeof d.user.email === 'string' ? d.user.email : '',
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
  };
};

export class ClienteSupabase {
  private readonly base: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly config: ConfigSupabase) {
    this.base = config.url.replace(/\/+$/, '');
    this.fetch = config.fetch ?? ((...args) => fetch(...args));
  }

  iniciarSesion(email: string, password: string): Promise<SesionSupabase> {
    return this.token('password', { email, password });
  }

  renovar(refreshToken: string): Promise<SesionSupabase> {
    return this.token('refresh_token', { refresh_token: refreshToken });
  }

  /** `rpc/mis_cursos` con el JWT del alumno: vacío si la cuenta está inactiva o no tiene cursos */
  async misCursos(accessToken: string): Promise<string[]> {
    const r = await this.fetch(`${this.base}/rest/v1/rpc/mis_cursos`, {
      method: 'POST',
      headers: {
        apikey: this.config.anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!r.ok) throw new Error(`Supabase respondió ${r.status} a mis_cursos().`);
    const datos: unknown = await r.json();
    if (!Array.isArray(datos) || !datos.every((c) => typeof c === 'string')) {
      throw new Error('mis_cursos() no devolvió una lista de cursos.');
    }
    return datos;
  }

  private async token(
    tipo: 'password' | 'refresh_token',
    cuerpo: Record<string, string>,
  ): Promise<SesionSupabase> {
    const r = await this.fetch(`${this.base}/auth/v1/token?grant_type=${tipo}`, {
      method: 'POST',
      headers: { apikey: this.config.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    // 400: credenciales malas, correo sin confirmar o refresh token ya usado o revocado.
    // Un 401 es otra cosa (anon key mala o vencida): error de configuración, no del alumno.
    if (r.status === 400) throw new CredencialesInvalidas();
    if (!r.ok) throw new Error(`Supabase respondió ${r.status} al iniciar sesión.`);
    const sesion = RespuestaToken(await r.json());
    if (!sesion) throw new Error('Supabase devolvió una sesión incompleta.');
    return sesion;
  }
}
