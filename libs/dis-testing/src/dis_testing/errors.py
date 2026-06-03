"""Minimal, test-only exceptions for dis-testing.

Deliberately local and minimal. The real DIS error hierarchy
(``dis_core.errors``) is a Slice 3 deliverable; Slice 3 should fold these (and
the three ``IdentityClientError`` variants in ``dis_core.identity.client``) into
that hierarchy so nothing is orphaned. Until then these keep the fakes/seeder
from reaching for raw ``RuntimeError`` / ``ValueError`` (root CLAUDE.md error rule).

dis-testing is test infrastructure only — never imported by production code.
"""

from __future__ import annotations


class TestInfraError(Exception):
    """Base for all dis-testing failures."""


class FixtureError(TestInfraError):
    """A fixture-truth lookup failed (unknown external id, inconsistent set)."""


class SeedError(TestInfraError):
    """The fixture seeder could not complete a write."""
