import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * A diferencia de PrismaModule, NO es @Global: el storage solo lo usan los
 * módulos que tocan archivos (videos hoy; stream en F3, worker en F4). El
 * import explícito documenta quién depende del storage.
 */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
