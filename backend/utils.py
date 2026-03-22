from backend._types import Message


def memory_to_string(memory: list[Message]):
    memory_str = ""
    for item in memory:
        memory_str += f"{item.role.upper()} : {item.content}\n"
    return memory_str
