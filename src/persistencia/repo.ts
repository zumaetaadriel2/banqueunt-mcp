/**
 * Dónde se guardan los simulacros y el progreso. Local: SQLite (sqlite.ts). Remoto (Fase 6):
 * Cloudflare D1 con el mismo esquema. Es asíncrono para que ambas implementaciones calcen.
 */

export interface ItemSimulacro {
  orden: number;
  preguntaId: string;
  /** firmaPregunta(): para no repetir la misma pregunta publicada en otro examen */
  firma: string;
  especialidad: string;
  tema: string;
  clave: number;
  nOpciones: number;
  /** null mientras no se corrige o si quedó sin responder */
  respuesta: number | null;
  correcta: boolean | null;
}

export interface Simulacro {
  id: string;
  usuario: string;
  curso: string;
  creadoEn: string;
  expiraEn: string;
  corregidoEn: string | null;
  aciertos: number | null;
  items: ItemSimulacro[];
}

export interface ResumenSimulacro {
  id: string;
  curso: string;
  creadoEn: string;
  corregidoEn: string;
  aciertos: number;
  total: number;
}

export interface ItemRespondido {
  simulacroId: string;
  curso: string;
  corregidoEn: string;
  preguntaId: string;
  especialidad: string;
  tema: string;
  correcta: boolean;
}

export interface ProgresoRepo {
  crearSimulacro(s: Simulacro): Promise<void>;
  obtenerSimulacro(id: string, usuario: string): Promise<Simulacro | undefined>;
  guardarCorreccion(
    id: string,
    usuario: string,
    corregidoEn: string,
    items: { orden: number; respuesta: number | null; correcta: boolean }[],
  ): Promise<void>;
  /** Firmas de las preguntas que ya salieron en algún simulacro del usuario en ese curso */
  firmasVistas(usuario: string, curso: string): Promise<Set<string>>;
  /** Simulacros corregidos, del más reciente al más antiguo */
  simulacrosCorregidos(usuario: string, curso?: string): Promise<ResumenSimulacro[]>;
  /** Cada pregunta respondida en un simulacro corregido, de la corrección más reciente a la más antigua */
  itemsRespondidos(usuario: string, curso?: string): Promise<ItemRespondido[]>;
  /** ¿El usuario ya corrigió alguna vez esta pregunta? (para explicar_pregunta) */
  preguntaCorregida(usuario: string, preguntaId: string): Promise<{ curso: string } | undefined>;
  cerrar(): void;
}
