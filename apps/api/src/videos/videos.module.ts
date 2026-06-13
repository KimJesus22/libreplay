import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StorageModule } from '@app/storage';
import { TRANSCRIBE_QUEUE } from '@app/queue';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [
    StorageModule,
    // Registra la cola `transcribe` en este módulo para poder inyectarla con
    // @InjectQueue en VideosService. defaultJobOptions vive aquí (productor)
    // porque es quien crea los jobs: 3 intentos con backoff exponencial (el
    // pipeline IA falla de forma transitoria —whisper saturado, red—; reintentar
    // suele bastar). removeOnComplete limpia Redis de jobs ya transcritos; los
    // fallidos se conservan para inspección. El criterio "fallo total → READY
    // publicable" (spec §6.2) lo aplica el worker tras agotar los intentos.
    BullModule.registerQueue({
      name: TRANSCRIBE_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
      },
    }),
  ],
  controllers: [VideosController],
  providers: [VideosService],
})
export class VideosModule {}
