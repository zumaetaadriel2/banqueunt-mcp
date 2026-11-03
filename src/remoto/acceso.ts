import type { ClienteSupabase, SesionSupabase } from './supabase.js';

/**
 * Qué se guarda en el grant OAuth (cifrado por workers-oauth-provider) y qué llega a cada llamada a /mcp.
 * El refresh token de Supabase solo vive en el grant: el handler de /mcp recibe `PropsAcceso`.
 */
export interface PropsAcceso {
  /** uuid de Supabase (auth.users.id) */
  usuario: string;
  email: string;
  /** Lo que devolvió mis_cursos() en el último login o renovación */
  cursos: string[];
}

export interface PropsGrant extends PropsAcceso {
  refreshSupabase: string;
}

/** La cuenta existe pero mis_cursos() está vacío: inactiva o sin cursos asignados */
export class SinCursos extends Error {
  constructor() {
    super('Tu cuenta de BanqueUNT no tiene acceso a ningún curso (o está inactiva).');
  }
}

async function propsDeSesion(cliente: ClienteSupabase, sesion: SesionSupabase): Promise<PropsGrant> {
  const cursos = await cliente.misCursos(sesion.accessToken);
  if (cursos.length === 0) throw new SinCursos();
  return { usuario: sesion.usuario, email: sesion.email, cursos, refreshSupabase: sesion.refreshToken };
}

/** Login en la página /authorize: valida con Supabase y pregunta una vez a mis_cursos() */
export async function autorizar(
  cliente: ClienteSupabase,
  email: string,
  password: string,
): Promise<PropsGrant> {
  return propsDeSesion(cliente, await cliente.iniciarSesion(email, password));
}

/**
 * Al renovar el token OAuth: renueva la sesión de Supabase y vuelve a leer mis_cursos(), así un cambio
 * del admin (o una cuenta desactivada) se aplica en la siguiente renovación. Lanza CredencialesInvalidas
 * o SinCursos si el alumno ya no debe tener acceso.
 */
export async function renovarAcceso(cliente: ClienteSupabase, grant: PropsGrant): Promise<PropsGrant> {
  return propsDeSesion(cliente, await cliente.renovar(grant.refreshSupabase));
}

export function propsPublicas({ usuario, email, cursos }: PropsAcceso): PropsAcceso {
  return { usuario, email, cursos };
}

/** Lo que llega en ctx.props: se valida porque es lo que decide de quién es el progreso */
export function leerPropsAcceso(props: unknown): PropsAcceso | undefined {
  const p = props as Partial<PropsAcceso> | undefined;
  if (typeof p?.usuario !== 'string' || !p.usuario || !Array.isArray(p.cursos)) return undefined;
  return {
    usuario: p.usuario,
    email: typeof p.email === 'string' ? p.email : '',
    cursos: p.cursos.map(String),
  };
}
