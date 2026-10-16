import argparse
import json
from pathlib import Path

from synthetic_data import generate_dataset


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Regenerate the deterministic Phase 3 sample datasets."
    )
    parser.add_argument("--size", type=int, default=25, help="Number of orders.")
    parser.add_argument("--seed", type=int, default=1, help="Deterministic random seed.")
    parser.add_argument(
        "--output-directory",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "samples",
    )
    args = parser.parse_args()
    if args.size < 0:
        parser.error("--size must be non-negative")

    args.output_directory.mkdir(parents=True, exist_ok=True)
    for scenario in ("plentiful", "scarce"):
        output = args.output_directory / f"{scenario}-dataset.json"
        content = (
            json.dumps(
                generate_dataset(args.size, args.seed, scenario),
                indent=2,
                ensure_ascii=False,
            )
            + "\n"
        )
        with output.open("w", encoding="utf-8", newline="\n") as sample_file:
            sample_file.write(content)
        print(f"Wrote {output}")


if __name__ == "__main__":
    main()
