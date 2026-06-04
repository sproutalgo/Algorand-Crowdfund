#!/usr/bin/env python3
"""Compile crowdfund.py to approval.teal and clear.teal"""
from pyteal import compileTeal, Mode
from crowdfund import approval_program, clear_program

approval_teal = compileTeal(approval_program(), mode=Mode.Application, version=8)
clear_teal = compileTeal(clear_program(), mode=Mode.Application, version=8)

with open("approval.teal", "w") as f:
    f.write(approval_teal)

with open("clear.teal", "w") as f:
    f.write(clear_teal)

print("Compiled approval.teal and clear.teal successfully.")
