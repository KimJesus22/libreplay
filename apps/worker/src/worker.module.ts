import { Module } from '@nestjs/common';

/**
 * Módulo raíz del worker — el segundo proceso Node del plan (plan.md §1).
 *
 * Separar API y worker en procesos distintos es una decisión load-bearing:
 * si el pipeline IA satura CPU o se cae, la API sigue sirviendo video.
 * La IA es mejora, no bloqueo (spec §6.2).
 *
 * En F4/F5 aquí se registran los procesadores BullMQ:
 * TranscriptionProcessor → MetadataProcessor → EmbeddingProcessor.
 * Por ahora está vacío a propósito: la Fase 0 solo exige que el target
 * `worker` exista, compile y arranque (plan.md §6, tabla de servicios).
 */
@Module({})
export class WorkerModule {}
