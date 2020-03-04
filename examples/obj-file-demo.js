import {tiny, defs} from './common.js';
                                                  // Pull these names into this module's scope for convenience:
const { vec3, vec4, vec, color, Mat4, Light, Shape, Material, Shader, Texture, Scene } = tiny;

export class Shape_From_File extends Shape
{                                   // **Shape_From_File** is a versatile standalone Shape that imports
                                    // all its arrays' data from an .obj 3D model file.
  constructor( filename )
    { super( "position", "normal", "texture_coord" );
                                    // Begin downloading the mesh. Once that completes, return
                                    // control to our parse_into_mesh function.
      this.load_file( filename );
    }
  load_file( filename )
      {                             // Request the external file and wait for it to load.
                                    // Failure mode:  Loads an empty shape.
        return fetch( filename )
          .then( response =>
            { if ( response.ok )  return Promise.resolve( response.text() )
              else                return Promise.reject ( response.status )
            })
          .then( obj_file_contents => this.parse_into_mesh( obj_file_contents ) )
          .catch( error => { this.copy_onto_graphics_card( this.gl ); } )
      }
  parse_into_mesh( data )
    {                           // Adapted from the "webgl-obj-loader.js" library found online:
      var verts = [], vertNormals = [], textures = [], unpacked = {};   

      unpacked.verts = [];        unpacked.norms = [];    unpacked.textures = [];
      unpacked.hashindices = {};  unpacked.indices = [];  unpacked.index = 0;

      var lines = data.split('\n');

      var VERTEX_RE = /^v\s/;    var NORMAL_RE = /^vn\s/;    var TEXTURE_RE = /^vt\s/;
      var FACE_RE = /^f\s/;      var WHITESPACE_RE = /\s+/;

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        var elements = line.split(WHITESPACE_RE);
        elements.shift();

        if      (VERTEX_RE.test(line))   verts.push.apply(verts, elements);
        else if (NORMAL_RE.test(line))   vertNormals.push.apply(vertNormals, elements);
        else if (TEXTURE_RE.test(line))  textures.push.apply(textures, elements);
        else if (FACE_RE.test(line)) {
          var quad = false;
          for (var j = 0, eleLen = elements.length; j < eleLen; j++)
          {
              if(j === 3 && !quad) {  j = 2;  quad = true;  }
              if(elements[j] in unpacked.hashindices) 
                  unpacked.indices.push(unpacked.hashindices[elements[j]]);
              else
              {
                  var vertex = elements[ j ].split( '/' );

                  unpacked.verts.push(+verts[(vertex[0] - 1) * 3 + 0]);
                  unpacked.verts.push(+verts[(vertex[0] - 1) * 3 + 1]);   
                  unpacked.verts.push(+verts[(vertex[0] - 1) * 3 + 2]);
                  
                  if (textures.length) 
                    {   unpacked.textures.push(+textures[( (vertex[1] - 1)||vertex[0]) * 2 + 0]);
                        unpacked.textures.push(+textures[( (vertex[1] - 1)||vertex[0]) * 2 + 1]);  }
                  
                  unpacked.norms.push(+vertNormals[( (vertex[2] - 1)||vertex[0]) * 3 + 0]);
                  unpacked.norms.push(+vertNormals[( (vertex[2] - 1)||vertex[0]) * 3 + 1]);
                  unpacked.norms.push(+vertNormals[( (vertex[2] - 1)||vertex[0]) * 3 + 2]);
                  
                  unpacked.hashindices[elements[j]] = unpacked.index;
                  unpacked.indices.push(unpacked.index);
                  unpacked.index += 1;
              }
              if(j === 3 && quad)   unpacked.indices.push( unpacked.hashindices[elements[0]]);
          }
        }
      }
      {
      const { verts, norms, textures } = unpacked;
        for( var j = 0; j < verts.length/3; j++ )
        { 
          this.arrays.position     .push( vec3( verts[ 3*j ], verts[ 3*j + 1 ], verts[ 3*j + 2 ] ) );        
          this.arrays.normal       .push( vec3( norms[ 3*j ], norms[ 3*j + 1 ], norms[ 3*j + 2 ] ) );
          this.arrays.texture_coord.push( vec( textures[ 2*j ], textures[ 2*j + 1 ] ) );
        }
        this.indices = unpacked.indices;
      }
      this.normalize_positions( false );
      this.ready = true;
    }
  draw( context, program_state, model_transform, material )
    {               // draw(): Same as always for shapes, but cancel all 
                    // attempts to draw the shape before it loads:
      if( this.ready )
        super.draw( context, program_state, model_transform, material );
    }
}

export class Obj_File_Demo extends Scene     
  {                           // **Obj_File_Demo** show how to load a single 3D model from an OBJ file.
                              // Detailed model files can be used in place of simpler primitive-based
                              // shapes to add complexity to a scene.  Simpler primitives in your scene
                              // can just be thought of as placeholders until you find a model file
                              // that fits well.  This demo shows the teapot model twice, with one 
                              // teapot showing off the Fake_Bump_Map effect while the other has a 
                              // regular texture and Phong lighting.             
    constructor()                               
      { super();
                                      // Load the model file:
          this.shapes = { "head": new Shape_From_File( "assets/Head.obj"),
              "top_torso": new Shape_From_File( "assets/Top-Torso.obj"),
              "bottom_torso": new Shape_From_File( "assets/Bottom-Torso.obj"),
              "left_arm": new Shape_From_File( "assets/Left-Arm.obj"),
              "left_hand": new Shape_From_File( "assets/Left-Hand.obj"),
              "right_arm": new Shape_From_File( "assets/Right-Arm.obj"),
              "right_hand": new Shape_From_File( "assets/Right-Hand.obj")};
                                      // Don't create any DOM elements to control this scene:
        this.widget_options = { make_controls: false };
                                                          // Non bump mapped:
        this.robot_texture = new Material( new defs.Textured_Phong( 1 ),  { color: color( .5,.5,.5,1 ),
         ambient: .3, diffusivity: .5, specularity: .5, texture: new Texture( "assets/R1_Color.jpg" ) });
                                                           // Bump mapped:
        this.bumps = new Material( new defs.Fake_Bump_Map( 1 ), { color: color( .5,.5,.5,1 ),
          ambient: .3, diffusivity: .5, specularity: .5, texture: new Texture( "assets/R1_Color.jpg" ) });
      }

      draw_robot(context, program_state, robot_center)
      {
          // Draw Robot at robot_center
          const top_torso_transform = robot_center;
          const head_transform = top_torso_transform.times(Mat4.translation(0, 2.9, 0));
          const bottom_torso_transform = top_torso_transform.times(Mat4.rotation(Math.PI, 0, 1, 0))
              .times(Mat4.translation(0, -2.0, 0));
          const left_arm_transform = top_torso_transform.times(Mat4.translation(2, 0, 0));
          const left_hand_transform = top_torso_transform.times(Mat4.translation(2.9, -2.7, 0))
              .times(Mat4.scale(0.5, 0.5, 0.5));
          const right_arm_transform = top_torso_transform.times(Mat4.translation(-2, 0, 0));
          const right_hand_transform = top_torso_transform.times(Mat4.translation(-2.9, -2.7, 0))
              .times(Mat4.scale(0.5, 0.5, 0.5));
          this.shapes.head.draw( context, program_state, head_transform, this.robot_texture);
          this.shapes.top_torso.draw( context, program_state, top_torso_transform, this.robot_texture);
          this.shapes.bottom_torso.draw( context, program_state, bottom_torso_transform, this.robot_texture);
          this.shapes.left_arm.draw( context, program_state, left_arm_transform, this.robot_texture);
          this.shapes.left_hand.draw( context, program_state, left_hand_transform, this.robot_texture);
          this.shapes.right_arm.draw( context, program_state, right_arm_transform, this.robot_texture);
          this.shapes.right_hand.draw( context, program_state, right_hand_transform, this.robot_texture);
      }


    display( context, program_state )
      { const t = program_state.animation_time;

        program_state.set_camera( Mat4.translation( 0,0, -10 ) );    // Locate the camera here (inverted matrix).
        program_state.projection_transform = Mat4.perspective( Math.PI/4, context.width/context.height, 1, 500 );
                                                // A spinning light to show off the bump map:
        program_state.lights = [ new Light( 
                                 Mat4.rotation( t/300,   1,0,0 ).times( vec4( 3,2,10,1 ) ), 
                                             color( 1,.7,.7,1 ), 100000 ) ];
        let time = t/1000;
        let robot_location = Mat4.identity().times(Mat4.scale(0.5, 0.5, 0.5)).times(Mat4.rotation(time * Math.PI/4, 0, 1, 0));
        this.draw_robot(context, program_state, robot_location);

      }
  show_explanation( document_element )
    { document_element.innerHTML += "<p>This demo loads an external 3D model file of a teapot.  It uses a condensed version of the \"webgl-obj-loader.js\" "
                                 +  "open source library, though this version is not guaranteed to be complete and may not handle some .OBJ files.  It is contained in the class \"Shape_From_File\". "
                                 +  "</p><p>One of these teapots is lit with bump mapping.  Can you tell which one?</p>";
    }
  }