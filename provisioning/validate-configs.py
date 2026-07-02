#!/usr/bin/env python3
"""Validate the repo's YAML/JSON configs. Used by CI and runnable locally.

Home Assistant uses custom tags (!include, !secret); we register a permissive
constructor so those files parse structurally without resolving the tags.
"""
import json
import sys

import yaml


class Loader(yaml.SafeLoader):
    pass


# Treat any !custom tag as null so HA configs parse structurally.
Loader.add_multi_constructor("!", lambda loader, suffix, node: None)

YAML_FILES = [
    "docker-compose.yml",
    "configs/frigate/config.yml",
    "configs/zigbee2mqtt/configuration.yaml",
    "configs/grafana/provisioning/datasources/postgres.yml",
    "configs/grafana/provisioning/dashboards/provider.yml",
    "configs/homeassistant/configuration.yaml",
    "configs/homeassistant/packages/alarm.yaml",
    "configs/homeassistant/packages/audit_mqtt.yaml",
    "configs/homeassistant/packages/notify.yaml",
    "configs/homeassistant/packages/security.yaml",
    "configs/homeassistant/packages/life_safety.yaml",
    "configs/homeassistant/packages/lighting.yaml",
    "configs/homeassistant/packages/presence.yaml",
    "configs/homeassistant/packages/presence_audio.yaml",
    "configs/homeassistant/packages/climate.yaml",
    "configs/esphome/konnected-alarm.example.yaml",
    "configs/esphome/presence-room.example.yaml",
]
JSON_FILES = [
    "services/archive-job/lifecycle.json",
    "configs/grafana/provisioning/dashboards/security-overview.json",
    "configs/grafana/provisioning/dashboards/ops-health.json",
]


def main() -> int:
    ok = True
    for f in YAML_FILES:
        try:
            yaml.load(open(f), Loader=Loader)
            print(f"YAML OK  {f}")
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"YAML ERR {f} -> {str(e)[:160]}")
    for f in JSON_FILES:
        try:
            json.load(open(f))
            print(f"JSON OK  {f}")
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"JSON ERR {f} -> {e}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
