import json
from pathlib import Path

from apps.api.nodeflow_api.node_doctor import inspect_node_packages, main


def write_manifest(package_dir: Path, *, entrypoints: list[str]) -> None:
    package_dir.mkdir(parents=True, exist_ok=True)
    (package_dir / "nodeflow-package.json").write_text(
        json.dumps(
            {
                "id": "example.doctor",
                "name": "Doctor Example",
                "version": "1.0.0",
                "engines": {
                    "nodeflow": ">=0.1.0,<0.2.0",
                    "python": ">=3.11",
                },
                "pythonDependencies": [],
                "nodeEntrypoints": entrypoints,
            }
        ),
        encoding="utf-8",
    )


def write_healthy_node(path: Path) -> None:
    path.write_text(
        '''
from nodeflow_sdk import BaseNode, Input, NodeConfig, Output, node


@node(id="example.healthy", name="Healthy", category="Example")
class HealthyNode(BaseNode[NodeConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {"success": Output()}
'''.lstrip(),
        encoding="utf-8",
    )


def write_faulty_dynamic_node(path: Path, *, required_config: bool = False) -> None:
    required_field = "token: str" if required_config else 'token: str = ""'
    path.write_text(
        f'''
from typing import Any

from pydantic import Field

from nodeflow_sdk import BaseNode, DynamicOutputList, NodeConfig, Output, node


class DynamicConfig(NodeConfig):
    rules: list[dict[str, str]] = Field(
        default_factory=lambda: [{{"id": "route", "label": "Route"}}]
    )
    {required_field}


@node(
    id="example.dynamic",
    name="Dynamic",
    category="Example",
    dynamic_outputs=DynamicOutputList(
        config_key="rules",
        output=Output(description="Dynamic"),
        default_items=({{"id": "route", "label": "Route"}},),
    ),
)
class DynamicNode(BaseNode[DynamicConfig]):
    outputs = {{"fallback": Output()}}

    @classmethod
    def output_ports(
        cls,
        config: dict[str, Any] | DynamicConfig | None = None,
    ) -> dict[str, Output]:
        raise RuntimeError("doctor caught this")
'''.lstrip(),
        encoding="utf-8",
    )


def test_doctor_reports_a_healthy_package_in_human_output(tmp_path: Path, capsys):
    package_dir = tmp_path / "healthy"
    write_manifest(package_dir, entrypoints=["node.py"])
    write_healthy_node(package_dir / "node.py")

    exit_code = main([str(package_dir)])

    output = capsys.readouterr().out
    assert exit_code == 0
    assert "节点包自检：通过" in output
    assert "1 个包，1 个节点" in output
    assert "[通过] Doctor Example (example.doctor) v1.0.0" in output


def test_doctor_json_output_is_stable_and_machine_readable(tmp_path: Path, capsys):
    package_dir = tmp_path / "healthy"
    write_manifest(package_dir, entrypoints=["node.py"])
    write_healthy_node(package_dir / "node.py")

    exit_code = main([str(package_dir / "nodeflow-package.json"), "--json"])

    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert payload["valid"] is True
    assert payload["summary"] == {
        "packageCount": 1,
        "loadedPackageCount": 1,
        "partialPackageCount": 0,
        "failedPackageCount": 0,
        "nodeCount": 1,
        "credentialTypeCount": 0,
        "legacyNodeCount": 0,
        "errorCount": 0,
        "warningCount": 0,
    }
    assert payload["nodes"] == [
        {
            "id": "example.healthy",
            "name": "Healthy",
            "version": 1,
            "packageId": "example.doctor",
            "staticInputCount": 1,
            "staticOutputCount": 1,
            "hasDynamicInputs": False,
            "hasDynamicOutputs": False,
        }
    ]
    assert payload["packages"][0]["engines"] == {
        "nodeflow": ">=0.1.0,<0.2.0",
        "python": ">=3.11",
    }
    assert payload["packages"][0]["compatibility"]["status"] == "compatible"


def test_doctor_fails_when_an_entrypoint_registers_no_nodes(tmp_path: Path):
    package_dir = tmp_path / "empty"
    write_manifest(package_dir, entrypoints=["empty.py"])
    (package_dir / "empty.py").write_text("VALUE = 1\n", encoding="utf-8")

    report = inspect_node_packages(package_dir)

    assert report.valid is False
    assert report.summary.failed_package_count == 1
    assert {diagnostic.code for diagnostic in report.diagnostics} == {
        "node_doctor_no_nodes",
        "package_entrypoint_no_nodes",
    }


def test_doctor_runs_default_dynamic_port_contracts(tmp_path: Path):
    package_dir = tmp_path / "dynamic"
    write_manifest(package_dir, entrypoints=["node.py"])
    write_faulty_dynamic_node(package_dir / "node.py")

    report = inspect_node_packages(package_dir)

    assert report.valid is False
    assert report.summary.node_count == 1
    issue = next(
        diagnostic
        for diagnostic in report.diagnostics
        if diagnostic.code == "node_output_port_resolution_failed"
    )
    assert issue.package_id == "example.doctor"
    assert issue.path == "example.dynamic"
    assert "doctor caught this" in issue.message


def test_doctor_strict_mode_can_fail_an_unchecked_dynamic_contract(tmp_path: Path, capsys):
    package_dir = tmp_path / "dynamic_required"
    write_manifest(package_dir, entrypoints=["node.py"])
    write_faulty_dynamic_node(package_dir / "node.py", required_config=True)

    normal_exit = main([str(package_dir), "--json"])
    normal_payload = json.loads(capsys.readouterr().out)
    strict_exit = main([str(package_dir), "--strict"])
    strict_output = capsys.readouterr().out

    assert normal_exit == 0
    assert normal_payload["valid"] is True
    assert normal_payload["summary"]["warningCount"] == 1
    assert normal_payload["diagnostics"][0]["code"] == "node_dynamic_port_default_check_skipped"
    assert strict_exit == 1
    assert "[警告] node_dynamic_port_default_check_skipped" in strict_output


def test_doctor_returns_usage_exit_code_for_a_missing_target(tmp_path: Path, capsys):
    exit_code = main([str(tmp_path / "missing")])

    output = capsys.readouterr()
    assert exit_code == 2
    assert output.out == ""
    assert "节点包自检无法开始" in output.err


def test_doctor_fails_before_importing_a_package_with_a_missing_dependency(
    tmp_path: Path,
    capsys,
):
    package_dir = tmp_path / "missing-dependency"
    write_manifest(package_dir, entrypoints=["node.py"])
    manifest_path = package_dir / "nodeflow-package.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["pythonDependencies"] = ["definitely-missing-nodeflow-distribution>=1"]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    (package_dir / "node.py").write_text(
        "raise RuntimeError('doctor must not import this entrypoint')\n",
        encoding="utf-8",
    )

    exit_code = main([str(package_dir), "--json"])
    payload = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert payload["packages"][0]["status"] == "failed"
    assert payload["packages"][0]["compatibility"]["status"] == "incompatible"
    assert {
        diagnostic["code"] for diagnostic in payload["diagnostics"]
    } == {
        "node_doctor_no_nodes",
        "package_python_dependency_missing",
    }
