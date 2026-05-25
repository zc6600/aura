# frozen_string_literal: true

module Aura
  module Commands
    class Dashboard
      BOX_CHARS = {
        top_left: "╭",
        top_right: "╮",
        bottom_left: "╰",
        bottom_right: "╯",
        horizontal: "─",
        vertical: "│",
        t_down: "┬",
        t_up: "┴",
        t_left: "┤",
        t_right: "├",
        cross: "┼"
      }.freeze

      WIDTH = 80
      SIDEBAR_WIDTH = 30
      MAIN_WIDTH = WIDTH - SIDEBAR_WIDTH - 3 # 3 for borders

      def initialize(project_path, config)
        @project_path = project_path
        @config = config
        @llm_config = @config["llm"] || {}
      end

      def render
        puts "\n"
        print_top_border
        print_content
        print_bottom_border
        puts "\n"
        print_input_hint
        puts "\n"
      end

      private

      def print_top_border
        title = " Aura Shell v#{begin
          Aura::VERSION
        rescue StandardError
          '1.0.0'
        end} "

        title.length
        title.length # -2 for corners

        line = BOX_CHARS[:top_left] +
               BOX_CHARS[:horizontal] * 3 +
               title +
               BOX_CHARS[:horizontal] * (WIDTH - 3 - title.length - 2) +
               BOX_CHARS[:top_right]
        puts line
      end

      def print_bottom_border
        line = BOX_CHARS[:bottom_left] +
               BOX_CHARS[:horizontal] * (WIDTH - 2) +
               BOX_CHARS[:bottom_right]
        puts line
      end

      def print_content
        # Layout:
        # | Main Area (Logo/Status) | Sidebar (Tips/Activity) |

        logo_lines = [
          "       ___   __  __  ____     ___   ",
          "      /   | / / / / / __ \\   /   |  ",
          "     / /| |/ / / / / /_/ /  / /| |  ",
          "    / ___ / /_/ / / _, _/  / ___ |  ",
          "   /_/  |_\\____/ /_/ |_|  /_/  |_|  ",
          "                                    ",
          "      :: AUTONOMOUS AGENT OS ::     "
        ]

        tips = [
          "Tips for getting started",
          "Run /help to see commands",
          "Run /clear to reset",
          BOX_CHARS[:horizontal] * (SIDEBAR_WIDTH - 4),
          "Recent activity",
          "No recent activity"
        ]

        # Calculate height based on logo or tips, whichever is taller
        height = [logo_lines.size + 4, tips.size + 2].max

        height.times do |i|
          # Left column content
          if i < logo_lines.size + 2 && i >= 2
            left_text = logo_lines[i - 2]
            # Center logo in main area
            padding = (MAIN_WIDTH - left_text.length) / 2
            left_col = " " * padding + colorize(left_text, 36) + " " * (MAIN_WIDTH - padding - left_text.length)
          elsif i == height - 2
            # Info line
            info = "Model: #{@llm_config['model'] || 'Unknown'}"
            left_col = " " * 2 + info + " " * (MAIN_WIDTH - info.length - 2)
          elsif i == height - 1
            # Path line
            path_str = truncate(@project_path, MAIN_WIDTH - 4)
            left_col = " " * 2 + colorize(path_str, 90) + " " * (MAIN_WIDTH - path_str.length - 2)
          else
            left_col = " " * MAIN_WIDTH
          end

          # Right column content
          if i < tips.size
            right_text = tips[i]
            right_col = " #{right_text}#{' ' * (SIDEBAR_WIDTH - right_text.length - 1)}"
          else
            right_col = " " * SIDEBAR_WIDTH
          end

          puts "#{BOX_CHARS[:vertical]}#{left_col}#{BOX_CHARS[:vertical]}#{right_col}#{BOX_CHARS[:vertical]}"
        end
      end

      def print_input_hint
        puts "#{' ' * 2}Try \"how does context work?\""
      end

      def colorize(text, color_code)
        "\e[#{color_code}m#{text}\e[0m"
      end

      def truncate(text, length)
        if text.length > length
          "...#{text[-(length - 3)..]}"
        else
          text
        end
      end
    end
  end
end
