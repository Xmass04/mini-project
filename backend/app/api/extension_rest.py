from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from app.core.db import get_session
from app.models.models import Job, Resume
from app.services.extension import ExtensionService

router = APIRouter(prefix="/extension", tags=["extension"])


class AnswerRequest(BaseModel):
    user_id: int
    job_id: int
    resume_id: int
    questions: list[str]


class AnswerItem(BaseModel):
    question: str
    answer: str


class AnswerResponse(BaseModel):
    answers: list[AnswerItem]


@router.post("/answers", response_model=AnswerResponse)
def get_answers(body: AnswerRequest, session: Session = Depends(get_session)):
    resume = session.get(Resume, body.resume_id)
    if not resume or resume.user_id != body.user_id:
        raise HTTPException(status_code=404, detail="Resume not found.")

    job = session.get(Job, body.job_id)
    if not job or job.user_id != body.user_id:
        raise HTTPException(status_code=404, detail="Job not found.")

    answers = [
        AnswerItem(
            question=question,
            answer=ExtensionService.generate_answer(
                resume.markdown_content, job.description, question
            ),
        )
        for question in body.questions
    ]

    return AnswerResponse(answers=answers)
