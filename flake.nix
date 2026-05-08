{
	description = "scotus-opinion-helper development shell (Node.js and npm)";

	inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

	outputs = { nixpkgs, ... }:
		let
			systems = [
				"aarch64-darwin"
				"aarch64-linux"
				"x86_64-darwin"
				"x86_64-linux"
			];
		in
		{
			devShells = nixpkgs.lib.genAttrs systems (
				system:
				let
					pkgs = import nixpkgs { inherit system; };
				in
				{
					default = pkgs.mkShell {
						packages = with pkgs; [
							nodejs
							sqlitebrowser
						];
					};
				}
			);
		};
}
