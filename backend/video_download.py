import os
import yt_dlp


url = 'https://www.youtube.com/watch?v=KcT3aVgrrpU'

mp4_opts = {
    'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    'outtmpl': '%(title)s.%(ext)s',
    'merge_output_format': 'mp4',
    'quiet': False,
}

mp3_opts = {
    'format': 'bestaudio/best',
    'postprocessors': [{
        'key': 'FFmpegExtractAudio',
        'preferredcodec': 'mp3',
        'preferredquality': '192',
    }],
    'outtmpl': '%(title)s.%(ext)s',
    'quiet': False,
}

def download(opts, label):
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            print(f"Downloading {label}...")
            ydl.download([url])
            print(f"{label} download complete!")
    except Exception as e:
        print(f"Error downloading {label}: {e}")


if __name__ == "__main__":
    download(mp4_opts, "MP4")
    download(mp3_opts, "MP3")

    mp3_filename = url.split("v=")[-1] + ".mp3"
