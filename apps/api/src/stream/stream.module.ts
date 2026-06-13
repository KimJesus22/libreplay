import { Module } from '@nestjs/common';
import { StorageModule } from '@app/storage';
import { StreamController } from './stream.controller';
import { StreamService } from './stream.service';

@Module({
  imports: [StorageModule],
  controllers: [StreamController],
  providers: [StreamService],
})
export class StreamModule {}
