from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Result(BaseModel, Generic[T]):
    code: int
    message: str
    data: T | None


class PageResult(BaseModel, Generic[T]):
    list: list[T]
    total: int
    page: int
    pageSize: int


def success(data: T | None = None, message: str = "success") -> Result[T]:
    return Result(code=200, message=message, data=data)


def error(code: int, message: str) -> Result[None]:
    return Result(code=code, message=message, data=None)

