import { FuenteIndexada, type FuenteBanco } from '../datos/fuentes.js';
import { Banco } from '../dominio/banco.js';

/**
 * Lo mínimo de un bucket de Cloudflare R2 que usa el Worker. El binding real (`env.BANCO`) lo cumple; los
 * tests lo imitan con un Map. Las claves reproducen data/ de examen-pwa: «index.json»,
 * «med2_unt/examenes_2021.json»… (las sube scripts/subir-banco.ts).
 */
export interface BucketBanco {
  get(clave: string): Promise<{ text(): Promise<string> } | null>;
  head(clave: string): Promise<{ etag: string } | null>;
}

export const CLAVE_INDICE = 'index.json';

/** El banco real en un bucket privado de R2, con las mismas comprobaciones que la carpeta local */
export class BancoR2 extends FuenteIndexada {
  readonly origen = 'r2';

  constructor(
    private readonly bucket: BucketBanco,
    habilitados: string[],
    avisar?: (mensaje: string) => void,
  ) {
    super(habilitados, avisar);
  }

  protected async leerTexto(relativa: string): Promise<string> {
    const objeto = await this.bucket.get(relativa);
    if (!objeto) throw new Error(`Falta ${relativa} en el bucket del banco (vuelve a correr subir-banco).`);
    return objeto.text();
  }
}

/** Cada cuánto se mira si cambió index.json en el bucket */
export const RECARGA_MS = 5 * 60 * 1000;

/**
 * Qué banco usa el Worker: el de R2 si ya se subió (hay index.json) o, si no, la muestra. Cada
 * RECARGA_MS compara el etag de index.json; si cambió (se subió una versión nueva), arma un Banco
 * nuevo y la caché vieja se descarta. Entre revisiones no toca el bucket.
 */
export class SelectorBanco {
  private actual?: { banco: Banco; etag: string | null; revisado: number };

  constructor(
    private readonly bucket: BucketBanco | undefined,
    private readonly habilitados: string[],
    private readonly muestra: () => FuenteBanco,
    private readonly ahora: () => number = Date.now,
  ) {}

  async banco(): Promise<Banco> {
    const ahora = this.ahora();
    if (this.actual && ahora - this.actual.revisado < RECARGA_MS) return this.actual.banco;

    const etag = this.bucket ? ((await this.bucket.head(CLAVE_INDICE))?.etag ?? null) : null;
    if (this.actual && this.actual.etag === etag) {
      this.actual.revisado = ahora;
      return this.actual.banco;
    }
    const fuente = etag !== null && this.bucket ? new BancoR2(this.bucket, this.habilitados) : this.muestra();
    this.actual = { banco: new Banco(fuente), etag, revisado: ahora };
    return this.actual.banco;
  }
}
