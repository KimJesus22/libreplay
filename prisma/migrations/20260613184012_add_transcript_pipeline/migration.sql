-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "durationS" INTEGER;

-- CreateTable
CREATE TABLE "Transcript" (
    "videoId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("videoId")
);

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
