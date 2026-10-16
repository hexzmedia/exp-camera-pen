# The camera as a pen

What does a computer see when it looks at you? Less than you think, and still enough to draw with.

This is the code behind the article [De camera als pen](https://hexz.net/zien/) on hexz.net (in Dutch). There you can try it, with your camera or with a drawn hand.

## The question

What does a computer see when it looks at you? And is that enough to draw with?

## What I did

I started on my own computer, with OpenCV, the best-known toolkit for computer vision. First in C++: read a photo and make it grey. Then in Python, with a well-known example: hold a coloured object in front of the camera, and the computer follows that colour and draws with it.

That works, but you need an object in exactly the right colour. I wanted to know whether it could be done with nothing: only your hand, and only movement.

That is what the example does. It runs in your browser, in four views:

- **What you see:** the normal picture.
- **What the computer sees:** only the edges.
- **What moves:** only the difference with the previous frame.
- **The pen:** the middle of everything that moves, and the line that point draws.

There is no OpenCV here. The steps are small enough to write by hand, and then you also see what happens.

## What surprised me

### The computer looks at almost nothing

The picture from your camera is 640 by 480 points here, in colour. The computer first makes it smaller and grey: 160 by 120 points, each one number. That is 19,200 numbers. Sixteen times fewer points than the picture you see, and without colour.

Look in the second view how coarse that is. Still you recognise yourself.

### Moving is a difference

The computer does not know what a hand is. It subtracts the previous frame from this one. Where the difference is large enough, something moves. That is all.

Stand still in the third view, and you disappear. You are still there, but for the computer you only exist as long as you change.

### One point is enough

Of all the points that move, the computer takes the middle. That one point is the pen.

It is a dumb pen. Move two hands, and the point sits in between. If someone walks past behind you, they draw along. And still it feels like drawing, as long as you are the only one moving.

### The light joins in

A flickering lamp, a cloud in front of the sun, a camera that adjusts its own brightness: then every point changes a little, and for the computer everything moves.

That is what the **gevoeligheid** (sensitivity) slider is for. The higher the number, the larger a difference has to be before it counts. Too low, and the noise draws along. Too high, and your hand is no longer seen.

### Fast enough is not the same as fast

The computing is not the problem. Look at the counter: on my computer a frame takes about half a millisecond.

What you do feel is delay. Set the **vertraging van de pen** (pen delay) slider to 100 milliseconds, and then to 300. The cross stays with your hand, the line follows behind. Somewhere along the way it stops being a pen, and becomes something you wait for.

## How it works

This is the step that finds what moves ([demo/see.js](demo/see.js)):

```js
for (let y = 0, i = 0; y < PH; y++) {
  for (let x = 0; x < PW; x++, i++) {
    const changed = Math.abs(grey[i] - previous[i]) > threshold;
    moving[i] = changed ? 1 : 0;
    if (changed) {
      n++;
      sumX += x;
      sumY += y;
    }
  }
}
```

For every point: is the difference with the previous frame larger than the threshold? Then it counts. On the way you add up where those points are.

Divide that sum by the number of points, and you have the middle:

```js
const x = sumX / n / PW;
const y = sumY / n / PH;
```

The line itself is the same as in [One scribble, ten languages](https://hexz.net/krabbel/): a row of a hundred points, where the newest point replaces the oldest.

## The picture stays with you

The camera only turns on when you ask for it. Everything is computed in your own browser. No picture goes to a server, and nothing is stored. Press **stop** or close the page, and the camera turns off.

If you would rather not use a camera, a drawn hand does the same.

## What is here

| File | What it is |
|---|---|
| [`index.html`](index.html) | The example on a page of its own |
| [`demo/see.js`](demo/see.js) | The camera (or the drawn hand), the four views, the pen and the counters |
| [`demo/see.css`](demo/see.css) | Its look |

The labels in the example are in Dutch, as on the site. The C++ and Python steps that came before are not in this repository: the Python version was a well-known example from the internet, not my own code.

## Run it

No build step. A browser only gives a page the camera on `https://` or on `localhost`, so serve it locally, for example:

```
python -m http.server 8000
```

Then open `http://localhost:8000/`.

## Made with the help of AI

The code, the example and this text were made with an AI assistant. The idea, the questions and the choices are mine.

## Licence

[MIT](LICENSE), copyright Hugo Scheepens.
