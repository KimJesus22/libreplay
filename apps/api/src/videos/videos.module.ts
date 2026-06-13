import { Module } from '@nestjs/common';
import { StorageModule } from '@app/storage';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [StorageModule],
  controllers: [VideosController],
  providers: [VideosService],
})
export class VideosModule {}
