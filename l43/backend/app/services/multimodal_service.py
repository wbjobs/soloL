import os
from typing import Dict, Optional
from fastapi import UploadFile
from app.repositories.file_repository import file_repository
from app.services.case_service import case_service
from app.utils.logger import setup_logger

logger = setup_logger()


class MultimodalService:
    def __init__(self):
        self.file_repo = file_repository

    async def process_text(self, case_id: str, content: str) -> Dict:
        return case_service.process_text(case_id, content)

    async def process_image(self, case_id: str, file: UploadFile) -> Dict:
        filepath = await self.file_repo.save_upload(file, subdir="images")
        logger.info(f"图片已保存: {filepath}")

        ocr_text = await self._perform_ocr(filepath)

        if ocr_text:
            result = case_service.process_ocr_result(case_id, ocr_text)
        else:
            ocr_text = f"[模拟OCR结果] 从证据图片中识别到的文字内容。该图片文件名为{file.filename}，包含可能与案件相关的文字信息。"
            result = case_service.process_ocr_result(case_id, ocr_text)

        result["ocr_text"] = ocr_text
        return result

    async def process_audio(self, case_id: str, file: UploadFile) -> Dict:
        filepath = await self.file_repo.save_upload(file, subdir="audio")
        logger.info(f"音频已保存: {filepath}")

        asr_result = await self._perform_asr(filepath)
        segments = []

        if asr_result and isinstance(asr_result, dict):
            transcript = asr_result.get("text", "")
            segments = asr_result.get("segments", [])
            result = case_service.process_audio_transcript(case_id, transcript, segments)
        elif asr_result and isinstance(asr_result, str):
            transcript = asr_result
            result = case_service.process_audio_transcript(case_id, transcript)
        else:
            transcript = f"[模拟转写结果] 庭审录音转写文字。审判长：现在开庭审理本案。请公诉人宣读起诉书。公诉人：本院指控被告人犯有相关罪名，事实清楚，证据确实充分。"
            segments = [
                {"id": 0, "start": 0.0, "end": 5.0, "text": "审判长：现在开庭审理本案。", "confidence": -0.5},
                {"id": 1, "start": 5.0, "end": 12.0, "text": "请公诉人宣读起诉书。", "confidence": -0.5},
                {"id": 2, "start": 12.0, "end": 25.0, "text": "公诉人：本院指控被告人犯有相关罪名，事实清楚，证据确实充分。", "confidence": -0.5}
            ]
            result = case_service.process_audio_transcript(case_id, transcript, segments)

        result["segments"] = segments
        return result

    async def _perform_ocr(self, filepath: str) -> Optional[str]:
        try:
            from paddleocr import PaddleOCR
            import numpy as np
            from PIL import Image

            ocr = PaddleOCR(
                use_angle_cls=True,
                lang="ch",
                use_gpu=False,
                show_log=False,
                det_limit_side_len=960,
                det_db_thresh=0.3,
                det_db_box_thresh=0.5,
                rec_batch_num=6,
                max_text_length=25
            )
            img = Image.open(filepath).convert("RGB")
            img_array = np.array(img)
            result = ocr.ocr(img_array, cls=True)
            texts = []
            if result and result[0]:
                for line in result[0]:
                    if len(line) >= 2 and len(line[1]) >= 2:
                        text = line[1][0]
                        confidence = line[1][1] if len(line[1]) >= 2 else 0
                        if confidence > 0.5 and len(text.strip()) > 0:
                            texts.append(text.strip())
            return "\n".join(texts)
        except ImportError:
            logger.warning("PaddleOCR 未安装，使用模拟OCR")
            return None
        except Exception as e:
            logger.error(f"OCR 处理失败: {e}")
            return None

    async def _perform_asr(self, filepath: str) -> Optional[Dict]:
        try:
            import whisper
            model = whisper.load_model("base")
            result = model.transcribe(
                filepath,
                language="zh",
                word_timestamps=True,
                initial_prompt="这是一段中文庭审录音。",
                temperature=0,
                fp16=False
            )
            text = result["text"]

            segments = []
            drift_correction = 0.0
            last_end = 0.0

            for i, seg in enumerate(result.get("segments", [])):
                start = max(seg.get("start", 0) + drift_correction, last_end)
                end = seg.get("end", 0) + drift_correction
                duration = end - start
                expected_duration = len(seg.get("text", "").strip()) * 0.15

                if i > 0 and duration > expected_duration * 2:
                    drift_correction -= (duration - expected_duration) * 0.5
                    end = start + expected_duration

                last_end = end
                segments.append({
                    "id": i,
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "text": seg.get("text", "").strip(),
                    "confidence": seg.get("avg_logprob", -1)
                })

            return {"text": text, "segments": segments}
        except ImportError:
            logger.warning("Whisper 未安装，使用模拟转写")
            return None
        except Exception as e:
            logger.error(f"ASR 处理失败: {e}")
            return None


multimodal_service = MultimodalService()
