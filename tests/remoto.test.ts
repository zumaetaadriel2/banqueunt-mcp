import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it, vi } from 'vitest';
import { CursoNoDisponible, type FuenteBanco } from '../src/datos/fuentes.js';
import { Banco } from '../src/dominio/banco.js';
import { D1ProgresoRepo } from '../src/persistencia/d1.js';
import { autorizar, leerPropsAcceso, propsPublicas, renovarAcceso, SinCursos } from '../src/remoto/acceso.js';
import { IntentosLogin, MAX_FALLOS_POR_CORREO, MAX_FALLOS_POR_IP } from '../src/remoto/intentos.js';
import { cabecerasHtml, paginaError, paginaLogin } from '../src/remoto/pagina.js';
import { ClienteSupabase, CredencialesInvalidas } from '../src/remoto/supabase.js';
import { crearServidor } from '../src/server.js';
import { d1EnMemoria } from './d1-falso.js';
import { pregunta } from './helpers.js';

const SESION = {
  access_token: 'jwt-del-alumno',
  refresh_token: 'refresh-1',
  user: { id: '6f1c2a40-0000-4000-8000-000000000001', email: 'ana@unitru.edu.pe' },
};

/** Un Supabase de mentira: responde según la ruta y guarda cada petición */
function supabaseFalso(respuestas: Record<string, { status: number; cuerpo: unknown }>): {
  cliente: ClienteSupabase;
  pedidos: { url: string; init: RequestInit }[];
} {
  const pedidos: { url: string; init: RequestInit }[] = [];
  const fetchFalso = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    pedidos.push({ url: u, init: init ?? {} });
    const clave = Object.keys(respuestas).find((r) => u.includes(r));
    const r = clave ? respuestas[clave]! : { status: 404, cuerpo: {} };
    return new Response(JSON.stringify(r.cuerpo), { status: r.status });
  });
  const cliente = new ClienteSupabase({
    url: 'https://proyecto.supabase.co/',
    anonKey: 'anon-publica',
    fetch: fetchFalso as unknown as typeof fetch,
  });
  return { cliente, pedidos };
}

describe('ClienteSupabase', () => {
  it('inicia sesión con correo y contraseña usando la anon key', async () => {
    const { cliente, pedidos } = supabaseFalso({ 'grant_type=password': { status: 200, cuerpo: SESION } });
    const sesion = await cliente.iniciarSesion('ana@unitru.edu.pe', 'secreta');
    expect(sesion).toEqual({
      usuario: SESION.user.id,
      email: 'ana@unitru.edu.pe',
      accessToken: 'jwt-del-alumno',
      refreshToken: 'refresh-1',
    });
    expect(pedidos[0]!.url).toBe('https://proyecto.supabase.co/auth/v1/token?grant_type=password');
    expect(new Headers(pedidos[0]!.init.headers).get('apikey')).toBe('anon-publica');
    expect(JSON.parse(String(pedidos[0]!.init.body))).toEqual({
      email: 'ana@unitru.edu.pe',
      password: 'secreta',
    });
  });

  it('credenciales malas o refresh token usado: CredencialesInvalidas', async () => {
    const { cliente } = supabaseFalso({
      'grant_type=password': { status: 400, cuerpo: { error: 'invalid_grant' } },
      'grant_type=refresh_token': { status: 400, cuerpo: { error: 'invalid_grant' } },
    });
    await expect(cliente.iniciarSesion('a@b.pe', 'x')).rejects.toBeInstanceOf(CredencialesInvalidas);
    await expect(cliente.renovar('viejo')).rejects.toBeInstanceOf(CredencialesInvalidas);
  });

  it.each([401, 503])('un %i de Supabase no se confunde con credenciales malas', async (status) => {
    const { cliente } = supabaseFalso({ 'grant_type=password': { status, cuerpo: {} } });
    const error = await cliente.iniciarSesion('a@b.pe', 'x').catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(CredencialesInvalidas);
    expect(String(error)).toContain(String(status));
  });

  it('mis_cursos() con el JWT del alumno', async () => {
    const { cliente, pedidos } = supabaseFalso({ 'rpc/mis_cursos': { status: 200, cuerpo: ['med2_unt'] } });
    expect(await cliente.misCursos('jwt-del-alumno')).toEqual(['med2_unt']);
    const h = new Headers(pedidos[0]!.init.headers);
    expect(h.get('Authorization')).toBe('Bearer jwt-del-alumno');
    expect(h.get('apikey')).toBe('anon-publica');
  });
});

describe('acceso', () => {
  it('autorizar: guarda usuario, cursos y el refresh token de Supabase', async () => {
    const { cliente } = supabaseFalso({
      'grant_type=password': { status: 200, cuerpo: SESION },
      'rpc/mis_cursos': { status: 200, cuerpo: ['med2_unt'] },
    });
    const props = await autorizar(cliente, 'ana@unitru.edu.pe', 'secreta');
    expect(props).toEqual({
      usuario: SESION.user.id,
      email: 'ana@unitru.edu.pe',
      cursos: ['med2_unt'],
      refreshSupabase: 'refresh-1',
    });
    // Lo que llega a /mcp no lleva el refresh token
    expect(propsPublicas(props)).toEqual({
      usuario: SESION.user.id,
      email: 'ana@unitru.edu.pe',
      cursos: ['med2_unt'],
    });
  });

  it('cuenta inactiva o sin cursos: SinCursos', async () => {
    const { cliente } = supabaseFalso({
      'grant_type=password': { status: 200, cuerpo: SESION },
      'rpc/mis_cursos': { status: 200, cuerpo: [] },
    });
    await expect(autorizar(cliente, 'ana@unitru.edu.pe', 'secreta')).rejects.toBeInstanceOf(SinCursos);
  });

  it('renovar: usa el refresh token guardado y vuelve a leer mis_cursos()', async () => {
    const { cliente, pedidos } = supabaseFalso({
      'grant_type=refresh_token': { status: 200, cuerpo: { ...SESION, refresh_token: 'refresh-2' } },
      'rpc/mis_cursos': { status: 200, cuerpo: ['med2_unt', 'encib'] },
    });
    const renovado = await renovarAcceso(cliente, {
      usuario: SESION.user.id,
      email: 'ana@unitru.edu.pe',
      cursos: ['med2_unt'],
      refreshSupabase: 'refresh-1',
    });
    expect(JSON.parse(String(pedidos[0]!.init.body))).toEqual({ refresh_token: 'refresh-1' });
    expect(renovado).toMatchObject({ cursos: ['med2_unt', 'encib'], refreshSupabase: 'refresh-2' });
  });

  it('leerPropsAcceso rechaza props sin usuario o sin cursos', () => {
    expect(leerPropsAcceso(undefined)).toBeUndefined();
    expect(leerPropsAcceso({ usuario: '', cursos: [] })).toBeUndefined();
    expect(leerPropsAcceso({ usuario: 'u1' })).toBeUndefined();
    expect(leerPropsAcceso({ usuario: 'u1', cursos: ['med2_unt'], extra: 1 })).toEqual({
      usuario: 'u1',
      email: '',
      cursos: ['med2_unt'],
    });
  });
});

describe('Banco.restringido', () => {
  const preguntas = {
    med2_unt: [pregunta({ id: 'M1' }), pregunta({ id: 'M1_BIS' })],
    encib: [pregunta({ id: 'E1', categoriaId: 'encib', pregunta: 'Otra' })],
  };
  const fuente = (): FuenteBanco & { leidas: string[] } => {
    const leidas: string[] = [];
    return {
      origen: 'prueba',
      leidas,
      cursos: async () => ['med2_unt', 'encib'],
      preguntas: async (curso) => {
        leidas.push(curso);
        return preguntas[curso as keyof typeof preguntas];
      },
    };
  };

  it('solo ve los cursos del alumno y comparte la caché entre alumnos', async () => {
    const f = fuente();
    const banco = new Banco(f);
    const ana = banco.restringido(['med2_unt']);
    const beto = banco.restringido(['med2_unt', 'residentado']);
    expect(await ana.cursos()).toEqual(['med2_unt']);
    expect(await beto.cursos()).toEqual(['med2_unt']); // residentado no está en la fuente
    await expect(ana.publicadas('encib')).rejects.toBeInstanceOf(CursoNoDisponible);
    await expect(ana.resolverCurso('encib')).rejects.toBeInstanceOf(CursoNoDisponible);
    expect(await ana.resolverCurso()).toBe('med2_unt');
    expect(await ana.unicas('med2_unt')).toHaveLength(1);
    expect(await beto.unicas('med2_unt')).toHaveLength(1);
    expect(f.leidas).toEqual(['med2_unt']); // deduplicado una sola vez para los dos
    expect(await ana.buscarEnCursos('E1')).toBeUndefined();
  });

  it('un alumno sin el curso no recibe preguntas por ninguna herramienta', async () => {
    const banco = new Banco(fuente()).restringido(['encib']);
    const server = crearServidor(banco, new D1ProgresoRepo(d1EnMemoria()), { usuario: 'beto' });
    const [lado1, lado2] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(lado1), client.connect(lado2)]);

    for (const [name, args] of [
      ['buscar_preguntas', { curso: 'med2_unt' }],
      ['generar_simulacro', { curso: 'med2_unt', cantidad: 1 }],
      ['estadisticas_banco', { curso: 'med2_unt' }],
    ] as const) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, name).toBe(true);
      expect(JSON.stringify(r.content)).not.toContain('M1');
    }
    await expect(client.readResource({ uri: 'banqueunt://pregunta/M1' })).rejects.toThrow();
  });
});

describe('IntentosLogin', () => {
  it('bloquea un correo tras varios fallos, sin afectar a otros, hasta que pasa la ventana', async () => {
    let ahora = new Date('2026-11-03T15:00:00Z');
    const intentos = new IntentosLogin(d1EnMemoria(), () => ahora);
    for (let i = 0; i < MAX_FALLOS_POR_CORREO; i++) {
      expect(await intentos.permitido('Ana@Unitru.edu.pe', '1.1.1.1')).toBe(true);
      await intentos.registrarFallo('ana@unitru.edu.pe ', '1.1.1.1');
    }
    expect(await intentos.permitido('ana@unitru.edu.pe', '2.2.2.2')).toBe(false);
    expect(await intentos.permitido('beto@unitru.edu.pe', '1.1.1.1')).toBe(true);
    ahora = new Date('2026-11-03T15:16:00Z');
    expect(await intentos.permitido('ana@unitru.edu.pe', '1.1.1.1')).toBe(true);
  });

  it('bloquea una IP que prueba muchos correos', async () => {
    const intentos = new IntentosLogin(d1EnMemoria(), () => new Date('2026-11-03T15:00:00Z'));
    for (let i = 0; i < MAX_FALLOS_POR_IP; i++) await intentos.registrarFallo(`u${i}@x.pe`, '9.9.9.9');
    expect(await intentos.permitido('nuevo@x.pe', '9.9.9.9')).toBe(false);
    expect(await intentos.permitido('nuevo@x.pe', '8.8.8.8')).toBe(true);
  });
});

describe('página de login', () => {
  const datos = {
    clientName: '<script>alert(1)</script>Claude',
    redirectHost: 'claude.ai"><img src=x>',
    redirectIsLoopback: false,
  };

  it('escapa todo lo que viene del cliente', () => {
    const html = paginaLogin(datos, 'h"1', { error: '<b>mal</b>', email: '"x"@y.pe' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>mal</b>');
    expect(html).toContain('&#60;script&#62;');
    expect(html).toContain('value="h&#34;1"');
    expect(html).toContain('no está verificado');
  });

  it('avisa cuando el acceso va a una app local y muestra el dominio verificado', () => {
    const html = paginaLogin(
      { ...datos, clientDomain: 'claude.ai', redirectHost: 'localhost', redirectIsLoopback: true },
      'h',
    );
    expect(html).toContain('tu computadora');
    expect(html).toContain('Publicada por <strong>claude.ai</strong>');
  });

  it('las páginas no se pueden enmarcar ni guardar en caché', () => {
    const h = cabecerasHtml();
    expect(h.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(h.get('X-Frame-Options')).toBe('DENY');
    // form-action bloquearía en Chrome la redirección de vuelta al cliente
    expect(h.get('Content-Security-Policy')).not.toContain('form-action');
    expect(h.get('Cache-Control')).toBe('no-store');
    expect(paginaError('<x>')).toContain('&#60;x&#62;');
  });
});
